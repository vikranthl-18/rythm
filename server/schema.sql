-- ---------------------------------------------------------------------------
-- rythm — PostgreSQL schema (Postgres + TimescaleDB)
-- Reference for the production backend. The web demo keeps state client-side
-- (src/store.ts); these tables mirror the shapes used there 1:1.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "timescaledb";  -- time-series hypertable
CREATE EXTENSION IF NOT EXISTS "vector";       -- pgvector for the AI coach

-- ---------------------------------------------------------------------------
-- Devices (Module 1: multi-device sync)
-- ---------------------------------------------------------------------------

CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  device_name VARCHAR(100) NOT NULL,            -- e.g. 'Pixel Watch 2', 'Colmi Ring R09'
  priority_rank INT CHECK (priority_rank BETWEEN 1 AND 3),
  source_type VARCHAR(50),                      -- 'HEALTH_CONNECT', 'HEALTHKIT', 'BLE_DIRECT'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Per-metric priority overrides (Rule 2: metric specialization).
CREATE TABLE device_metric_priority (
  user_id UUID NOT NULL,
  metric_type VARCHAR(50) NOT NULL,             -- 'HR','HRV','STEPS','SKIN_TEMP','SPO2','SLEEP',...
  device_order UUID[] NOT NULL,                 -- ordered device ids, most preferred first
  PRIMARY KEY (user_id, metric_type)
);

-- ---------------------------------------------------------------------------
-- Time-series health metrics (Module 1 output + Module 2 input)
-- ---------------------------------------------------------------------------

CREATE TABLE health_metrics (
  time TIMESTAMP WITH TIME ZONE NOT NULL,
  user_id UUID NOT NULL,
  device_id UUID REFERENCES user_devices(id),
  metric_type VARCHAR(50) NOT NULL,             -- 'HR','HRV','RHR','STEPS','ACTIVE_ENERGY','SKIN_TEMP','SPO2','RESP_RATE','SLEEP'
  value NUMERIC NOT NULL,
  PRIMARY KEY (time, user_id, metric_type, device_id)
);

SELECT create_hypertable('health_metrics', 'time');
CREATE INDEX idx_health_metrics_user_time ON health_metrics (user_id, time DESC);
CREATE INDEX idx_health_metrics_user_type ON health_metrics (user_id, metric_type, time DESC);

-- ---------------------------------------------------------------------------
-- Daily summaries (Module 2: recovery & strain engine output)
-- ---------------------------------------------------------------------------

CREATE TABLE daily_health_summaries (
  date DATE NOT NULL,
  user_id UUID NOT NULL,
  recovery_score INT CHECK (recovery_score BETWEEN 0 AND 100),
  recovery_color VARCHAR(10),                   -- 'green' | 'yellow' | 'red'
  day_strain NUMERIC(4,1) CHECK (day_strain BETWEEN 0.0 AND 21.0),
  sleep_score INT,
  sleep_need_seconds INT,
  sleep_debt_seconds INT,
  hrv_baseline NUMERIC,
  rhr_baseline NUMERIC,
  total_sleep_duration_seconds INT,
  PRIMARY KEY (date, user_id)
);

-- ---------------------------------------------------------------------------
-- Workouts (Module 3)
-- ---------------------------------------------------------------------------

CREATE TABLE workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  activity_type VARCHAR(50) NOT NULL,           -- 'run','trail','cycle','walk','hiit','strength','yoga'
  title VARCHAR(150),
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_seconds INT NOT NULL,
  distance_meters NUMERIC,
  elevation_gain_meters NUMERIC,
  avg_hr INT,
  max_hr INT,
  workout_strain NUMERIC(4,1),
  zone_minutes JSONB,                           -- {"z1":n,...,"z5":n}
  splits_seconds JSONB,                         -- [sec, sec, ...]
  route_geojson JSONB,                          -- GPS track (LineString with timestamps)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_workouts_user_start ON workouts (user_id, start_time DESC);

-- ---------------------------------------------------------------------------
-- Habits (Module 4)
-- ---------------------------------------------------------------------------

CREATE TABLE habits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title VARCHAR(150) NOT NULL,
  icon VARCHAR(8),
  color VARCHAR(10),
  target_type VARCHAR(20) CHECK (target_type IN ('BOOLEAN','NUMERIC','DURATION')),
  target_value NUMERIC,
  unit VARCHAR(20),
  frequency_type VARCHAR(20),                   -- 'DAILY','WEEKDAYS','CUSTOM'
  custom_days INT[],
  times_per_week INT,
  auto_sync_metric VARCHAR(50),                 -- link to health_metrics.metric_type or 'SLEEP'
  auto_sync_op VARCHAR(5) CHECK (auto_sync_op IN ('gte','lte')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE habit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id UUID REFERENCES habits(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  completed BOOLEAN DEFAULT false,
  value_recorded NUMERIC,
  UNIQUE(habit_id, log_date)
);

-- ---------------------------------------------------------------------------
-- AI coach (Module 5)
-- ---------------------------------------------------------------------------

CREATE TABLE coach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role VARCHAR(10) NOT NULL,                    -- 'user' | 'coach'
  content TEXT NOT NULL,
  context_snapshot JSONB,                       -- the context window assembled for the reply
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vector store for historical-context retrieval (RAG over past briefs).
CREATE TABLE coach_context_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX ON coach_context_embeddings USING hnsw (embedding vector_cosine_ops);
