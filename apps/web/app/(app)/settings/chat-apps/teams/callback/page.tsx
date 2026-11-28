import { finishChatInstall } from '../../callback';

// Per-user: completes the admin's install.
export const dynamic = 'force-dynamic';

export default async function ChatInstallCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return finishChatInstall('teams', searchParams);
}
