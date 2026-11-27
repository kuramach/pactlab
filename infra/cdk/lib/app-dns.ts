import { CfnOutput, Fn, Stack } from 'aws-cdk-lib';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface AppDnsProps {
  /** The app's host, e.g. app.stage.pactlab.ai: the zone's apex. */
  readonly host: string;
  /** Where the name points: the load balancer while awake, the sleep page while hibernated. */
  readonly target: { readonly loadBalancer: elbv2.ILoadBalancerV2 } | { readonly sleepPage: cloudfront.IDistribution };
  /** The load balancer's certificate for `host`, DNS-validated: its validation record moves into this zone. */
  readonly certificateArn: string;
}

/**
 * The app's name in Route 53 (Kumar, 2026-11-27; ADR 0063). Namecheap delegates `host` to this
 * zone once (its NS records are an output). The apex is an alias, to the load balancer while awake
 * and to the sleep page while hibernated, flipped by the same deploy that changes the shape; alias
 * queries to either are free. The certificate's validation record is copied into the zone from ACM,
 * so renewal keeps working once Namecheap no longer answers for the name.
 */
export class AppDns extends Construct {
  readonly zone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: AppDnsProps) {
    super(scope, id);
    const stack = Stack.of(this);
    this.zone = new route53.PublicHostedZone(this, 'Zone', { zoneName: props.host, comment: `Pactlab: ${props.host} (delegated from Namecheap)` });

    const target = 'loadBalancer' in props.target ? new targets.LoadBalancerTarget(props.target.loadBalancer) : new targets.CloudFrontTarget(props.target.sleepPage);
    new route53.ARecord(this, 'Apex', { zone: this.zone, target: route53.RecordTarget.fromAlias(target) });

    // ACM's validation record for the load balancer's certificate, read from ACM (it was validated at Namecheap).
    const validation = new cr.AwsCustomResource(this, 'CertificateValidation', {
      onUpdate: {
        service: 'ACM',
        action: 'describeCertificate',
        parameters: { CertificateArn: props.certificateArn },
        physicalResourceId: cr.PhysicalResourceId.of(`validation-${props.host}`),
        outputPaths: ['Certificate.DomainValidationOptions.0.ResourceRecord.Name', 'Certificate.DomainValidationOptions.0.ResourceRecord.Value'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: [props.certificateArn] }),
      installLatestAwsSdk: false,
    });
    new route53.CfnRecordSet(this, 'CertificateValidationRecord', {
      hostedZoneId: this.zone.hostedZoneId,
      name: validation.getResponseField('Certificate.DomainValidationOptions.0.ResourceRecord.Name'),
      type: 'CNAME',
      ttl: '300',
      resourceRecords: [validation.getResponseField('Certificate.DomainValidationOptions.0.ResourceRecord.Value')],
    });

    new CfnOutput(stack, 'AppZoneNameServers', { value: Fn.join(' ', this.zone.hostedZoneNameServers ?? []), description: `NS records to add at Namecheap for ${props.host}` });
  }
}
