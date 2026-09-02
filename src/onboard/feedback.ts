import { DOCFORCE_VERSION } from "../version.js";

export function renderFeedbackTemplate(repository: string): string {
  return `# DocForce Beta Feedback

Repository: ${repository}
DocForce version: ${DOCFORCE_VERSION}

Rate 1–5:

- Setup ease
- Architecture accuracy
- Document usefulness
- Visual quality
- Trust/confidence

Questions:

1. What important architecture did DocForce miss?
2. What did DocForce identify incorrectly?
3. Which section of the generated documentation was most useful?
4. Which section was confusing/noisy?
5. Would you share this document with another engineer? Why/why not?
6. What would stop you adopting DocForce?
`;
}
