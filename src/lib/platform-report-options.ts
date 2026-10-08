export type SearchValues = Record<string,string|string[]|undefined>;
export const PERIODS = [[1,"Today"],[7,"Last 7 days"],[30,"Last 30 days"],[90,"Last 90 days"]] as const;
export const FILTERS = {all:"All restaurants",recent:"Recently registered",active:"Active in period",inactive:"No activity in period",setup:"Setup incomplete",ready:"Ready, no recent orders"};
export const SORTS = {newest:"Newest first",oldest:"Oldest first",activity:"Most recently active",orders:"Most submitted orders",name:"Alphabetical"};
export function reportOptions(search:SearchValues) {
  const single=(key:string)=>typeof search[key]==="string"?search[key] as string:"";
  const days=Number(single("days")),page=Number(single("page"));
  return {days:[1,7,30,90].includes(days)?days:30,page:Number.isInteger(page)&&page>=1&&page<=1000000?page:1,
    size:single("size")==="50"?50:25,search:single("q").trim().slice(0,100),
    filter:Object.hasOwn(FILTERS,single("filter"))?single("filter") as keyof typeof FILTERS:"all",
    sort:Object.hasOwn(SORTS,single("sort"))?single("sort") as keyof typeof SORTS:"newest"};
}
export function directoryUrl(search:SearchValues,page:number) {
  const o=reportOptions(search);return `/platform/restaurants?${new URLSearchParams({days:String(o.days),page:String(page),size:String(o.size),q:o.search,filter:o.filter,sort:o.sort})}`;
}
export const count=(n:number)=>new Intl.NumberFormat("en-US").format(n);
export const decimal=(n:number|null)=>n===null?"Unavailable":new Intl.NumberFormat("en-US",{maximumFractionDigits:2,minimumFractionDigits:2}).format(n);
export const utcDate=(value:string|null)=>value?new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(value))+" UTC":"None recorded";
