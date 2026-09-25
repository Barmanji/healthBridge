import { requireAuth } from '@/modules/auth/actions';
import { Navbar } from '@/components/navbar';
import React from 'react'

const RootLayout = async({children}:{children:React.ReactNode}) => {
 const session = await requireAuth();

  const user = session?.user ? {
    ...session.user,
    image: session.user.image ?? null,
  } : null;

  return (
    <main className='flex flex-col min-h-screen'>
        <Navbar userRole={userRole}/>
        <div className='flex-1 flex flex-col px-4'>
   <div className="absolute inset-0 -z-10 h-full w-full bg-background dark:bg-[radial-gradient(#393e4a_1px,transparent_1px)] dark:bg-size-[16px_16px] bg-[radial-gradient(#dadde2_1px,transparent_1px)] bg-size-[16px_16px]" />

        {children}
        </div>
    </main>
  )
}

export default RootLayout
