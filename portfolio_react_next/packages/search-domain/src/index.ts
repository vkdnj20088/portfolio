export { CORPUS, ALL_PASSAGES, DOC_BY_ID } from './corpus';
export { search, tokenize, tokenizeQuery, idfOf } from './retrieval';
export type { FollowUpContext } from './retrieval';
export { createIndex, DEFAULT_SYNONYMS } from './textIndex';
export type { IndexedDoc, ScoredDoc, TextIndex } from './textIndex';
export { extractAnswer, CONFIDENCE_THRESHOLD, RETRIEVAL_FLOOR, MRC_TOP_K } from './mrc';
export { evaluate } from './eval/evaluate';
export type { EvalReport, EvalRow, RetrievalScore } from './eval/evaluate';
export { GOLDSET } from './eval/goldset';
export { evaluateFollowUp, validateFollowUpGoldset, FOLLOWUP_GOLDSET } from './eval/followup';
export type { FollowUpCase, FollowUpReport, FollowUpScore } from './eval/followup';
export type { EvalCase, EvalSplit } from './eval/goldset';
export { createDocQaApi, answerChunks, ANSWER_STEP_MS } from './docQaApi';
export type { DocQaApi } from './docQaApi';
export { verifyGrounding } from './grounding';
export type { GroundingReport } from './grounding';
export type {
  Doc,
  Passage,
  ScoredPassage,
  Answer,
  AnswerEvent,
  SearchMode,
} from './types';
