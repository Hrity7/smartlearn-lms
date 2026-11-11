export interface AiQuestionDraft {
  id: string;
  question: string;
  question_type: 'mcq' | 'subjective';
  marks: number;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface GenerateQuestionsParams {
  lessonContent: string;
  count: number;
  difficulty: 'easy' | 'medium' | 'hard';
  mcqRatio: number;
  topic?: string;
}
