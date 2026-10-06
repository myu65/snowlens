import LedgerTable from "../../../components/ledger-table";
export default async function Page({
  params,
}: {
  params: Promise<{ space: string; id: string }>;
}) {
  const { space, id } = await params;
  return <LedgerTable spaceId={space} id={id} />;
}
