import LedgerDesigner from "../../../components/ledger-designer";
export default async function Page({
  params,
}: {
  params: Promise<{ space: string }>;
}) {
  const { space } = await params;
  return <LedgerDesigner spaceId={space} />;
}
