import LedgerDesigner from "../../../../components/ledger-designer";
export default async function Page({
  params,
}: {
  params: Promise<{ space: string; id: string }>;
}) {
  const { space, id } = await params;
  return <LedgerDesigner spaceId={space} id={id} />;
}
