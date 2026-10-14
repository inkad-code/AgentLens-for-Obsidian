import singleDemoImage from "./assets/onboarding/single-demo.png";
import metadataImage from "./assets/onboarding/metadata.png";
import saveObsidianImage from "./assets/onboarding/save-obsidian.png";

type WorkflowOnboardingVariant = "single" | "bulk" | "auto";

const content: Record<WorkflowOnboardingVariant, { title: string; description: string; steps: [string, string][] }> = {
  single: {
    title: "Try Your First Sync, Zero Setup Required",
    description: "We've prepared a sample link for you. Test the full workflow with one click.",
    steps: [
      ["Start with Demo URL", "Use the pre-filled link to experience the preview process."],
      ["Complete & Clear Metadata", "Access complete and clear metadata parsed from web sources."],
      ["Save to Obsidian", "Preview AI auto-tagged media and save everything in 1-click."]
    ]
  },
  bulk: {
    title: "Try Your First Sync, Zero Setup Required",
    description: "We've prepared a sample link for you. Test the full workflow with one click.",
    steps: [
      ["Start with Demo URL", "Use the pre-filled link to review a creator's posts."],
      ["Complete & Clear Metadata", "Access complete and clear metadata parsed from web sources."],
      ["Save to Obsidian", "Preview selected posts and save everything in 1-click."]
    ]
  },
  auto: {
    title: "Auto-Sync New Posts in Background",
    description: "Monitor creators automatically and deliver fresh content straight to Obsidian.",
    steps: [
      ["Copy & Parse Creator Link", "Add a creator once and let AgentLens monitor new posts."],
      ["Set Frequency & Folder", "Choose how often to check and where new notes should go."],
      ["Save to Obsidian", "Keep fresh creator posts organized in your Vault automatically."]
    ]
  }
};

export function WorkflowOnboarding({ variant, onRequestSignUp }: { variant: WorkflowOnboardingVariant; onRequestSignUp?: (() => void) | undefined }) {
  const current = content[variant];
  const illustrations = [singleDemoImage, metadataImage, saveObsidianImage];
  const titleId = `agentlens-onboarding-title-${variant}`;
  return (
    <section className={`agentlens-onboarding agentlens-onboarding-${variant}`} aria-labelledby={titleId}>
      <h3 id={titleId}>{current.title}</h3>
      <p className="agentlens-onboarding-description">{current.description}</p>
      <div className="agentlens-onboarding-cards">
        {current.steps.map(([heading, description], index) => (
          <article className="agentlens-onboarding-card" key={heading}>
            <div className="agentlens-onboarding-illustration" aria-hidden="true">
              <img src={illustrations[index]} alt="" />
            </div>
            <p className="agentlens-onboarding-step">STEP {index + 1}</p>
            <h4>{heading}</h4>
            <p>{description}</p>
          </article>
        ))}
      </div>
      <button type="button" className="mod-cta agentlens-onboarding-cta" onClick={onRequestSignUp}>Start Free <span aria-hidden="true">→</span></button>
    </section>
  );
}
