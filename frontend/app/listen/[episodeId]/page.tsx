import { ListeningScreen } from "@/components/listening/ListeningScreen";

export default async function ListenPage({
  params,
}: {
  params: Promise<{ episodeId: string }>;
}) {
  const { episodeId } = await params;
  return <ListeningScreen key={episodeId} episodeId={episodeId} />;
}
