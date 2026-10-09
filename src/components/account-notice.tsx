import { accountAvailable } from "@/lib/account-availability";
export async function AccountNotice({restaurantId}:{restaurantId:string}) {
 if(await accountAvailable(restaurantId)) return null;
 return <p role="status" className="mb-4 rounded border p-4">This restaurant account is temporarily suspended. New orders and visits are unavailable. Your records remain accessible. Contact platform support for assistance.</p>;
}
