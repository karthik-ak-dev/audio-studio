import type { Session } from "./session";

export interface Topic {
  topic_id: string;
  host_user_id: string;
  topic_name: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTopicRequest {
  host_user_id: string;
  topic_name: string;
}

export interface TopicWithSessions {
  topic: Topic;
  sessions: Session[];
}
