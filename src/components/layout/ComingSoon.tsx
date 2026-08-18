import { Card } from "@/components/ui/Card";

export function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="mt-2 text-slate-600">{description}</p>
      <p className="mt-4 inline-flex rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
        This workflow has not been built yet.
      </p>
    </Card>
  );
}
