import { accountAvailable } from "@/lib/account-availability";
import { notFound } from "next/navigation";

import { CustomerMenu } from "@/components/menu/customer-menu";
import { getMenuData } from "@/lib/menu-data";

export default async function BranchMenuPage(props: PageProps<"/menu/[restaurant]/[branch]">) {
  const { restaurant: restaurantSlug, branch: branchSlug } = await props.params;
  const data = await getMenuData(restaurantSlug, branchSlug);

  if (!data) notFound();
  if (!await accountAvailable(data.restaurant.id)) return <p className="p-6">Ordering is temporarily unavailable. Please contact restaurant staff.</p>;

  return (
    <CustomerMenu
      restaurant={data.restaurant}
      categories={data.categories}
      branchId={data.branch.id}
      theme={data.theme}
    />
  );
}
