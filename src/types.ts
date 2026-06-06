export interface AppState {
  temperature: number | null;
  humidity: number | null;
  relays: {
    1: boolean;
    2: boolean;
    3: boolean;
    4: boolean;
  };
  patterns: {
    1: boolean;
    2: boolean;
  };
}

export type TopicType = "iot/sensor/suhu" | "iot/sensor/kelembapan";

export interface LogEntry {
  id: string;
  source: "system" | "user" | "voice" | "receive" | "send";
  message: string;
  timestamp: Date;
}
