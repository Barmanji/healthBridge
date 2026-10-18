"use server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const currentUser = async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session?.user ?? null;
};



export const requireAuth = async()=>{
   const session = await auth.api.getSession({
    headers: await headers(),
  });

  if(!session){
    return redirect("/sign-in")
  }

  return session
}

export const requireUnAuth = async()=>{
   const session = await auth.api.getSession({
    headers: await headers(),
  });

  if(session){
    return redirect("/")
  }

  return null;
}
