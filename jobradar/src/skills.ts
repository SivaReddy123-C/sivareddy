/**
 * Deterministic skill/role extraction. The feed carries no descriptions (it
 * must stay small enough to serve from a CDN), so without this a title is all
 * ranking has to work with - and titles rarely contain "sql" or "aws". We
 * extract a canonical tag set from title + description here, once, in the
 * pipeline, and ship the tags in the feed so matching is about the actual work.
 * A dictionary, not a model: same input, same tags, forever.
 */

/** canonical tag -> the ways it is written in the wild */
const DICTIONARY: Record<string, string[]> = {
  // languages
  python: ["python"], sql: ["sql"], java: ["java"], typescript: ["typescript", "ts"],
  javascript: ["javascript", "js"], go: ["golang", "\\bgo\\b"], rust: ["rust"],
  "c++": ["c\\+\\+"], "c#": ["c#", "\\.net", "dotnet"], scala: ["scala"], ruby: ["ruby", "rails"],
  php: ["php"], kotlin: ["kotlin"], swift: ["swift"], r: ["\\br\\b"], bash: ["bash", "shell script"],
  // frontend
  react: ["react"], angular: ["angular"], vue: ["vue"], nextjs: ["next\\.js", "nextjs"],
  frontend: ["front-?end", "ui engineer"], css: ["css", "tailwind"],
  // backend / platform
  backend: ["back-?end", "server-?side"], node: ["node\\.js", "nodejs"],
  api: ["\\bapis?\\b", "rest", "graphql", "grpc"], microservices: ["microservice"],
  fullstack: ["full-?stack"],
  // data
  spark: ["spark"], kafka: ["kafka"], airflow: ["airflow"], dbt: ["\\bdbt\\b"],
  snowflake: ["snowflake"], redshift: ["redshift"], databricks: ["databricks"],
  etl: ["\\betl\\b", "elt", "data pipeline"], warehouse: ["data warehouse", "warehousing"],
  bi: ["tableau", "power ?bi", "looker", "business intelligence"],
  analytics: ["analytics", "data analysis"], pandas: ["pandas", "numpy"],
  // ml / ai
  ml: ["machine learning", "\\bml\\b", "pytorch", "tensorflow", "scikit"],
  ai: ["\\bai\\b", "artificial intelligence", "\\bllm\\b", "generative ai"],
  nlp: ["\\bnlp\\b", "natural language"],
  // cloud / infra
  aws: ["\\baws\\b", "amazon web services"], azure: ["azure"], gcp: ["\\bgcp\\b", "google cloud"],
  kubernetes: ["kubernetes", "k8s"], docker: ["docker", "container"], terraform: ["terraform"],
  devops: ["devops", "ci/cd", "cicd"], sre: ["\\bsre\\b", "site reliability"],
  linux: ["linux", "unix"], infrastructure: ["infrastructure", "platform engineer"],
  // databases
  postgres: ["postgres", "postgresql"], mysql: ["mysql"], mongodb: ["mongo"],
  redis: ["redis"], oracle: ["oracle"], elasticsearch: ["elasticsearch", "opensearch"],
  // disciplines
  security: ["security", "infosec", "appsec"], mobile: ["mobile", "\\bios\\b", "android"],
  qa: ["\\bqa\\b", "quality assurance", "test automation", "sdet"],
  embedded: ["embedded", "firmware"], hardware: ["hardware", "asic", "fpga"],
  // non-engineering roles, so those postings are tagged too and can be excluded
  sales: ["account executive", "sales", "business development", "quota"],
  marketing: ["marketing", "seo", "demand generation", "brand"],
  recruiting: ["recruit", "talent acquisition", "sourcer"],
  finance: ["accounting", "financial analyst", "controller", "audit", "tax"],
  hr: ["human resources", "people operations", "\\bhr\\b"],
  support: ["customer support", "technical support", "help desk"],
  operations: ["operations manager", "supply chain", "logistics", "warehouse associate"],
  design: ["\\bux\\b", "\\bui/ux\\b", "product design", "graphic design"],
  product: ["product manager", "product owner"],
  consulting: ["consultant", "advisory"],
  healthcare: ["nurse", "clinical", "pharmacy", "patient care", "medical"],
  legal: ["attorney", "paralegal", "legal counsel"],
};

const COMPILED: [string, RegExp][] = Object.entries(DICTIONARY).map(
  ([tag, aliases]) => [tag, new RegExp(aliases.join("|"), "i")],
);

/** Canonical tags present in a posting. Title is weighted by being searched too. */
export function extractTags(title: string, description: string | null): string[] {
  const haystack = `${title}\n${(description ?? "").slice(0, 4000)}`;
  const tags: string[] = [];
  for (const [tag, re] of COMPILED) {
    if (re.test(haystack)) tags.push(tag);
  }
  return tags;
}

/** Tags a user's stated skills map onto, so profiles and postings share a vocabulary. */
export function normalizeProfileSkills(skills: string[]): string[] {
  const out = new Set<string>();
  for (const raw of skills) {
    const s = raw.trim().toLowerCase();
    if (!s) continue;
    out.add(s);
    for (const [tag, re] of COMPILED) {
      if (re.test(s)) out.add(tag);
    }
  }
  return [...out];
}
