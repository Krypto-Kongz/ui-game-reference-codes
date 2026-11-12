// AcademyTypes.ts - shared types for the Academy data + panel. Library script.
export interface Quiz { q: string; choices: string[]; answer: number; }
export interface Lesson {
  id: string; title: string; subtitle: string; level: string; levelColor: string;
  minutes: number; img: string; steps: string[]; tip: string; keywords: string[]; quiz: Quiz;
}
export interface Section { key: string; label: string; color: string; blurb: string; lessons: Lesson[]; }
