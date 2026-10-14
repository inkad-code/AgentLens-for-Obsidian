import { describe, expect, it } from 'vitest';
import { saveProgressLabel } from '../src/ui/workbench/savePresentation';
it('converts progress tokens only at the display boundary',()=>{
 const progress='written · 2 attachment(s) saved · 1 failed';
 expect(saveProgressLabel(progress)).toBe('Note saved. Some files couldn’t be saved. Review the results.');
 expect(progress).toBe('written · 2 attachment(s) saved · 1 failed');
 expect(saveProgressLabel('skipped_duplicate · 0 attachment(s) saved')).toBe('Already saved. No action is needed.');
 expect(saveProgressLabel('Writing note · 3 attachment(s) planned')).toBe('Saving note…');
 expect(saveProgressLabel('failed · SQLSTATE private diagnostic')).not.toContain('SQLSTATE');
});

describe("save progress feedback", () => {
  it.each(["partial · 0 attachment(s) saved · 1 failed", "partial · 2 attachment(s) saved · 1 failed"])("reports a confirmed partial write without an unknown-operation warning: %s", progress => {
    expect(saveProgressLabel(progress)).toBe("Note saved. Some files couldn’t be saved. Review the results.");
  });
  it("keeps genuinely unconfirmed operations distinct", () => {
    expect(saveProgressLabel("The provider result is not yet known. Reconcile this request before starting another attempt.")).toContain("Contact Support");
  });
});
