/**
 * Employer-type classification behind a mockable interface.
 *
 * This pass ships the deterministic stub: a curated list of known staffing /
 * consultancy brands plus name keywords. An LLM implementation can replace
 * StubClassifier later without touching scoring - scoring only ever reads the
 * *stored* classification, never calls a model (deterministic by design).
 */

export type EmployerType = "product" | "staffing" | "consultancy" | "agency" | "unknown";

export interface EmployerClassification {
  type: EmployerType;
  confidence: number; // 0-1
  reason: string;
}

export interface Classifier {
  classifyEmployer(name: string, website?: string): EmployerClassification;
}

const KNOWN_STAFFING = [
  "randstad", "adecco", "manpower", "teksystems", "aerotek", "insight global",
  "robert half", "kforce", "hays", "allegis", "kelly services", "experis",
  "collabera", "cybercoders", "jobot", "motion recruitment",
];
const KNOWN_CONSULTANCY = [
  "accenture", "cognizant", "capgemini", "wipro", "hcl", "tcs",
  "tata consultancy", "ltimindtree", "mindtree", "deloitte", "kpmg",
  "ernst & young", "pwc",
];
const STAFFING_KEYWORDS = /staffing|recruit(ing|ment)|talent (agency|partners|solutions)|workforce solutions|headhunt/i;
const CONSULTANCY_KEYWORDS = /consultanc(y|ies)|consulting|outsourc/i;

export class StubClassifier implements Classifier {
  classifyEmployer(name: string): EmployerClassification {
    const n = name.toLowerCase();
    for (const brand of KNOWN_STAFFING) {
      if (n.includes(brand)) return { type: "staffing", confidence: 0.95, reason: `Known staffing firm: ${brand}` };
    }
    for (const brand of KNOWN_CONSULTANCY) {
      if (n.includes(brand)) return { type: "consultancy", confidence: 0.9, reason: `Known consultancy: ${brand}` };
    }
    if (STAFFING_KEYWORDS.test(name)) return { type: "staffing", confidence: 0.7, reason: "Staffing keyword in company name" };
    if (CONSULTANCY_KEYWORDS.test(name)) return { type: "consultancy", confidence: 0.6, reason: "Consultancy keyword in company name" };
    return { type: "unknown", confidence: 0, reason: "No signal in name; needs LLM or manual tag" };
  }
}
