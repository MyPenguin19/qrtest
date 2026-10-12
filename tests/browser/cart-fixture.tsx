import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {CartProvider} from '../../src/components/menu/cart-provider';
import {CartBar} from '../../src/components/menu/cart-bar';
import {AddToCartDialog} from '../../src/components/menu/add-to-cart-dialog';
const item={id:'coffee',name:'A very long coffee name with extra descriptive words and SuperLongUnbrokenItemNameThatMustWrapOnSmallScreens',description:'Freshly prepared coffee.',image_url:null,base_price:10,is_veg:true,is_bestseller:false,is_available:true,menu_variants:[{id:'small',name:'Small',price:10,is_default:true},{id:'large',name:'Large',price:15,is_default:false}],menu_addons:[{id:'milk',name:'Oat milk',price:2}]};
function Fixture(){const [open,setOpen]=useState(false);return <CartProvider><button onClick={()=>setOpen(true)}>Choose coffee</button><AddToCartDialog item={item} open={open} onOpenChange={setOpen}/><CartBar/></CartProvider>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
