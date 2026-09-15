import { EditorLayout } from "@/components/editor/EditorLayout";

/* In Next 16 params is a Promise. The editor itself is a client component; this
   server component exists only to unwrap the route param. */
export default async function EditSongPage({
  params,
}: {
  params: Promise<{ song: string }>;
}) {
  const { song } = await params;
  return <EditorLayout song={decodeURIComponent(song)} />;
}
