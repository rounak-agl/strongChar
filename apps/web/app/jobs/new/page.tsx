// Post a training job: the CSV is prepared and sealed in this browser; only ciphertext and transactions leave it.
import { Upload } from "lucide-react";
import { Page } from "@/components/page";
import { PostJob } from "@/components/jobs/post-job";

export const metadata = { title: "Post a job" };

export default function NewJob() {
  return (
    <Page crumbs={[{ href: "/jobs", label: "jobs" }, { label: "post a job" }]} icon={Upload} title="Post a training job"
          meta={<>Your file is read, split and sealed with ML-KEM-1024 in this browser. The verifiers can open the shards; the coordinator stores only ciphertext; the finished model comes back sealed to you.</>}>
      <PostJob />
    </Page>
  );
}
