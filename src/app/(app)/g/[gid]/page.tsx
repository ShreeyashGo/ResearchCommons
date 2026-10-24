import { Dashboard } from "@/components/dashboard/dashboard";

export default async function GroupDashboardPage({
  params,
}: {
  params: Promise<{ gid: string }>;
}) {
  const { gid } = await params;
  return <Dashboard groupId={gid} />;
}
