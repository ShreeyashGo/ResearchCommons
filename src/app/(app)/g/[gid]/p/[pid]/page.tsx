import { Reader } from "@/components/reader/reader";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ gid: string; pid: string }>;
}) {
  const { gid, pid } = await params;
  return <Reader key={`${gid}:${pid}`} groupId={gid} paperId={pid} />;
}
