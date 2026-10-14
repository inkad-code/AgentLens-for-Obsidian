import { useI18n } from "../../i18n/I18nProvider";

/** Show exactly the properties in the write plan, outside the Markdown body. */
export function NoteProperties({ frontmatter }: { frontmatter: Readonly<Record<string, unknown>> }) {
  const { t } = useI18n();
  return <section className="agentlens-note-properties" aria-label={t("note.propertiesLabel")}>
    <h4>{t("note.properties")}</h4>
    <dl>{Object.entries(frontmatter).map(([key, value]) => <div key={key}>
      <dt>{key}</dt><dd>{Array.isArray(value) ? value.join(", ") || "—" : value == null || value === "" ? "—" : String(value)}</dd>
    </div>)}</dl>
  </section>;
}
