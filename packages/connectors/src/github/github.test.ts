import {
  analyseKeyPersonRisk,
  detectGhostCommits,
  ghostCommitFinding,
  keyPersonFindings,
  newId,
} from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { cassetteFetch } from '../http/cassette';
import { checkAdapterContract } from '../testing';
import { helloWorld, STATIC_AUTH } from './test-support';
import {
  createGitHubAdapter,
  GitHubFixtureAdapter,
  GitHubLiveAdapter,
  readAllCommits,
} from './index';

const scope = () => ({
  organizationId: newId(),
  dealId: newId(),
  connectionId: newId(),
  credentialRef: null,
});

describe('GitHub adapters', () => {
  it('fixture and live adapters satisfy the connector contract', async () => {
    const config = { repository: 'healthyco/platform' };
    await expect(checkAdapterContract(new GitHubFixtureAdapter(config), scope())).resolves.toEqual(
      [],
    );
    const live = new GitHubLiveAdapter({ repository: 'octocat/Hello-World' }, () => STATIC_AUTH, cassetteFetch(await helloWorld()));
    await expect(checkAdapterContract(live, scope())).resolves.toEqual([]);
  });

  it('selects by mode with one config shape and rejects malformed config', () => {
    expect(createGitHubAdapter('FIXTURE', { repository: 'healthyco/platform' })?.mode).toBe(
      'FIXTURE',
    );
    expect(createGitHubAdapter('LIVE', { repository: 'healthyco/platform' })?.mode).toBe('LIVE');
    expect(createGitHubAdapter('FIXTURE', { repository: '../../etc' })).toBeNull();
    expect(createGitHubAdapter('LIVE', { repository: '../etc' })).toBeNull();
    expect(createGitHubAdapter('LIVE', { repository: 'octocat/..' })).toBeNull();
    expect(createGitHubAdapter('LIVE', { repository: 'octocat/.' })).toBeNull();
    expect(createGitHubAdapter('LIVE', { repository: 'octo-cat/my.repo_1' })?.mode).toBe('LIVE');
    expect(createGitHubAdapter('FIXTURE', { repository: 'a/b', token: 'ghp_x' })).toBeNull();
  });

  it('live adapter without a credential fails closed and calls nothing', async () => {
    const replay = cassetteFetch(await helloWorld());
    const live = new GitHubLiveAdapter({ repository: 'octocat/Hello-World' }, () => null, replay);
    const validation = await live.validateConnection(scope());
    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'credentials')?.status).toBe('FAIL');
    await expect(live.head(scope())).rejects.toMatchObject({ code: 'NO_CREDENTIAL' });
    expect(replay.requests).toEqual([]);
  });

  it('pages deterministically and returns metadata only', async () => {
    const adapter = new GitHubFixtureAdapter({ repository: 'healthyco/platform' });
    const first = await adapter.listCommits(scope(), { cursor: null, limit: 50 });
    expect(first.commits).toHaveLength(50);
    expect(first.nextCursor).toBe('50');
    const all = await readAllCommits(adapter, scope(), 7);
    expect(all).toHaveLength(120);
    expect(new Set(all.map((commit) => commit.sha)).size).toBe(120);
    expect(all).toEqual(await readAllCommits(adapter, scope()));
    expect(Object.keys(all[0]!).sort()).toEqual([
      'additions',
      'authorIdentity',
      'authoredAt',
      'committedAt',
      'deletions',
      'paths',
      'sha',
    ]);
    await expect(adapter.listCommits(scope(), { cursor: 'x', limit: 5 })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    const dry = await adapter.dryRun(scope(), { limit: 5 });
    expect(dry).toMatchObject({ truncated: true });
    expect(dry.sample).toHaveLength(5);
  });

  it('SparseCo surfaces partial permissions instead of failing silently', async () => {
    const adapter = new GitHubFixtureAdapter({ repository: 'sparseco/app' });
    const validation = await adapter.validateConnection(scope());
    expect(validation.ok).toBe(false);
    expect(validation.checks.find((check) => check.name === 'scopes')).toMatchObject({
      status: 'FAIL',
      detail: 'Missing permissions: contents:read',
    });
    await expect(adapter.head(scope())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const unknown = new GitHubFixtureAdapter({ repository: 'nobody/nothing' });
    expect((await unknown.validateConnection(scope())).ok).toBe(false);
  });
});

describe('synthetic repository signals', () => {
  async function signals(repository: string) {
    const adapter = new GitHubFixtureAdapter({ repository });
    const commits = await readAllCommits(adapter, scope());
    const source = {
      evidenceItemId: newId(),
      headCommitSha: (await adapter.head(scope())).headSha,
    };
    return {
      ghost: ghostCommitFinding(
        detectGhostCommits(commits, await adapter.identityMap(scope())),
        source,
      ),
      keyPerson: keyPersonFindings(analyseKeyPersonRisk(commits), source),
    };
  }

  it('HealthyCo produces no ghost-commit or key-person drafts', async () => {
    expect(await signals('healthyco/platform')).toEqual({ ghost: null, keyPerson: [] });
  });

  it('TroubledCo ghost commits and billing concentration surface as drafts', async () => {
    const { ghost, keyPerson } = await signals('troubledco/core');
    expect(ghost).toMatchObject({
      domain: 'CODE_PROVENANCE',
      severity: 'HIGH',
      title: '11 commits attributed to unmatched or departed identities',
    });
    expect(keyPerson.map((draft) => draft.title)).toEqual([
      'Single-contributor concentration in billing/',
    ]);
    expect(JSON.stringify({ ghost, keyPerson })).not.toMatch(/tc-(dev|contractor)/);
  });
});
