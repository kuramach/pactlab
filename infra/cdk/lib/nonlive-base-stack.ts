import { createHash } from 'node:crypto';
import { CfnOutput, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type { Construct } from 'constructs';

/**
 * NAT on Amazon Linux 2023. CDK's default script finds the outbound interface
 * with `route`, which AL2023 does not ship, so no MASQUERADE rule is ever
 * added and nothing gets out. This one uses `ip route`, gives the 0.5 GB
 * instance swap so the package install is not killed, and fails loudly.
 */
export const NAT_USER_DATA_COMMANDS = [
  'set -euo pipefail',
  // A t4g.nano has 0.5 GB; dnf's repository metadata alone gets it OOM-killed. Swap first.
  'if [ ! -f /swapfile ]; then fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile; fi',
  'swapon /swapfile || true',
  'dnf install -y --setopt=install_weak_deps=False iptables-services',
  'systemctl enable --now iptables',
  'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/custom-ip-forwarding.conf',
  'sysctl -p /etc/sysctl.d/custom-ip-forwarding.conf',
  "IFACE=$(ip route show default | awk '{print $5; exit}')",
  'test -n "$IFACE"',
  'iptables -t nat -A POSTROUTING -o "$IFACE" -j MASQUERADE',
  'iptables -F FORWARD',
  'service iptables save',
];

/** The NAT instance non-live environments use instead of a managed NAT gateway (about $3–4 a month, not about $33). */
export function natInstanceProvider(): ec2.NatInstanceProviderV2 {
  const userData = ec2.UserData.forLinux();
  userData.addCommands(...NAT_USER_DATA_COMMANDS);
  return ec2.NatProvider.instanceV2({
    instanceType: new ec2.InstanceType('t4g.nano'),
    machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
    userData,
    // Nothing from the internet may open a connection to the NAT instance; only the VPC's own traffic (below) comes in.
    defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
  });
}

/** A changed start-up script runs only on a new instance: tie each NAT instance's identity to its script. */
function replaceNatInstancesOnScriptChange(vpc: ec2.Vpc): void {
  const digest = createHash('sha256').update(NAT_USER_DATA_COMMANDS.join('\n')).digest('hex').slice(0, 8);
  for (const subnet of vpc.publicSubnets) {
    const instance = subnet.node.tryFindChild('NatInstance') as ec2.Instance | undefined;
    if (!instance) continue;
    const cfn = instance.node.defaultChild as ec2.CfnInstance;
    cfn.overrideLogicalId(`${Stack.of(vpc).getLogicalId(cfn)}${digest}`);
  }
}

/** A VPC with Pactlab's three tiers: public, app (outbound through NAT) and data (isolated). */
export function pactlabVpc(scope: Construct, id: string, network: { maxAzs: number; nat: 'gateway' | 'instance'; natGateways: number }): ec2.Vpc {
  const instance = network.nat === 'instance' ? natInstanceProvider() : undefined;
  const vpc = new ec2.Vpc(scope, id, {
    maxAzs: network.maxAzs,
    natGateways: network.nat === 'instance' ? 1 : network.natGateways,
    ...(instance ? { natGatewayProvider: instance } : {}),
    subnetConfiguration: [
      { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
      { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
  });
  // The NAT instance forwards the private subnets' outbound traffic; it must accept it from inside the VPC.
  instance?.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTraffic(), 'VPC outbound through the NAT instance');
  if (instance) replaceNatInstancesOnScriptChange(vpc);
  vpc.addFlowLog('FlowLog');
  return vpc;
}

export interface NonliveBaseProps extends StackProps {
  /** The app hosts served here (e.g. app.dev.pactlab.ai): each gets a DNS-validated certificate on the shared listener. */
  readonly hosts: readonly string[];
  /**
   * `hibernated` only when every environment on the base is hibernated (ADR 0063): then the network, NAT
   * instance, load balancer and Redis are left out, and only the certificates stay, at the same logical IDs.
   */
  readonly power?: 'awake' | 'hibernated';
}

/**
 * What dev and qa share (Kumar, 2026-10-31; ADR 0019): one network with a NAT
 * instance, one load balancer, one Redis. Each environment brings its own
 * database, secrets, key, buckets, services and pause, attaches host-based
 * rules to the shared listener, and uses its own Redis logical database.
 * Stage and live keep their own; live is never on shared infrastructure.
 */
export class PactlabNonliveBaseStack extends Stack {
  /** Absent while hibernated (ADR 0063): the network, load balancer and Redis are rebuilt on wake. */
  readonly vpc?: ec2.Vpc;
  readonly loadBalancer?: elbv2.ApplicationLoadBalancer;
  readonly loadBalancerSecurityGroup?: ec2.SecurityGroup;
  readonly httpsListener?: elbv2.ApplicationListener;
  readonly redis?: elasticache.CfnReplicationGroup;
  readonly redisSecurityGroup?: ec2.SecurityGroup;
  readonly power: 'awake' | 'hibernated';
  private readonly certificates: ReadonlyMap<string, acm.Certificate>;

  constructor(scope: Construct, id: string, props: NonliveBaseProps) {
    const { hosts, power = 'awake', ...stackProps } = props;
    super(scope, id, stackProps);
    Tags.of(this).add('pactlab:environment', 'nonlive-shared');
    if (hosts.length === 0) throw new Error('The shared base needs at least one app host');
    this.power = power;

    // DNS-validated, one per environment host; kept while hibernated, so a wake reattaches them (ADR 0063).
    // Their validation records live in each environment's Route 53 zone (AppDns).
    this.certificates = new Map(
      hosts.map((host) => [host, new acm.Certificate(this, `Certificate-${host.split('.').slice(0, -2).join('-')}`, { domainName: host, validation: acm.CertificateValidation.fromDns() })]),
    );
    if (power === 'hibernated') return;

    const vpc = (this.vpc = pactlabVpc(this, 'Vpc', { maxAzs: 2, nat: 'instance', natGateways: 1 }));

    const loadBalancerSecurityGroup = (this.loadBalancerSecurityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', { vpc, description: 'Pactlab non-live public HTTPS' }));
    loadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');
    loadBalancerSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP, redirected to HTTPS');
    const loadBalancer = (this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: loadBalancerSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
    }));
    loadBalancer.addListener('Http', { port: 80, defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }) });
    this.httpsListener = loadBalancer.addListener('Https', {
      port: 443,
      certificates: [...this.certificates.values()],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      open: false,
      // Each environment adds rules for its own host; anything else is not served.
      defaultAction: elbv2.ListenerAction.fixedResponse(404, { contentType: 'text/plain', messageBody: 'Not found' }),
    });

    const redisSecurityGroup = (this.redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', { vpc, description: 'Pactlab non-live Redis (BullMQ)', allowAllOutbound: false }));
    const redisSubnets = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: 'Pactlab non-live Redis isolated subnets',
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
    });
    // One small node; environments are kept apart by Redis logical database (REDIS_URL …/<n>), cluster mode off.
    this.redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: 'Pactlab non-live BullMQ queues (dev, qa)',
      engine: 'redis',
      engineVersion: '7.1',
      cacheNodeType: 'cache.t4g.micro',
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      multiAzEnabled: false,
      snapshotRetentionLimit: 0,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      cacheSubnetGroupName: redisSubnets.ref,
      securityGroupIds: [redisSecurityGroup.securityGroupId],
    });

    new CfnOutput(this, 'LoadBalancerDns', { value: loadBalancer.loadBalancerDnsName });
  }

  /** What only an awake base has; an awake environment on it needs all of it. */
  awake(): { vpc: ec2.Vpc; loadBalancer: elbv2.ApplicationLoadBalancer; loadBalancerSecurityGroup: ec2.SecurityGroup; httpsListener: elbv2.ApplicationListener; redis: elasticache.CfnReplicationGroup; redisSecurityGroup: ec2.SecurityGroup } {
    const { vpc, loadBalancer, loadBalancerSecurityGroup, httpsListener, redis, redisSecurityGroup } = this;
    if (!vpc || !loadBalancer || !loadBalancerSecurityGroup || !httpsListener || !redis || !redisSecurityGroup) throw new Error('An environment is awake: the shared base must be awake too');
    return { vpc, loadBalancer, loadBalancerSecurityGroup, httpsListener, redis, redisSecurityGroup };
  }

  /** The certificate this base holds for an environment's host. */
  certificateFor(host: string): acm.Certificate {
    const certificate = this.certificates.get(host);
    if (!certificate) throw new Error(`The shared base holds no certificate for ${host}`);
    return certificate;
  }
}
