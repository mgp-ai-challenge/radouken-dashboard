import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-medium text-[#202124]">
          Dashboard
        </h1>
        <p className="mt-1 text-sm font-normal text-[#5f6368]">
          Overview of your activity and quick actions.
        </p>
      </header>
      <section className="rounded-lg border border-[#e8eaed] bg-white p-6 shadow-none">
        <h2 className="text-base font-medium text-[#202124]">
          Welcome
        </h2>
        <p className="mt-2 text-sm font-normal leading-relaxed text-[#5f6368]">
          You may now add components and start building. We&apos;ve already
          added the button component for you.
        </p>
        <Button className="mt-4">Get started</Button>
      </section>
    </div>
  )
}
