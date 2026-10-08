/** Read all matching rows rather than silently truncating a restaurant at 1,000. */
export async function readAllRows<T>(page:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>) {
  const rows:T[]=[];
  for(let from=0;;from+=1000) {
    const result=await page(from,from+999);
    if(result.error || !result.data)throw new Error("Could not load dashboard data. Please refresh.");
    rows.push(...result.data);if(result.data.length<1000)return rows;
  }
}
