-- public.addons definition
-- Drop table
-- DROP TABLE public.addons;
CREATE TABLE public.addons (
  id bigserial NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  deleted_at timestamptz NULL,
  "name" varchar(127) NULL,
  workshop_id varchar(127) NULL,
  CONSTRAINT addons_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_addons_deleted_at ON public.addons USING btree (deleted_at);
-- public.ocap_infos definition
-- Drop table
-- DROP TABLE public.ocap_infos;
CREATE TABLE public.ocap_infos (
  id bigserial NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  deleted_at timestamptz NULL,
  group_name varchar(127) NULL,
  group_description varchar(255) NULL,
  group_website varchar(255) NULL,
  group_logo varchar(255) NULL,
  CONSTRAINT ocap_infos_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_ocap_infos_deleted_at ON public.ocap_infos USING btree (deleted_at);
-- public.worlds definition
-- Drop table
-- DROP TABLE public.worlds;
CREATE TABLE public.worlds (
  id bigserial NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  deleted_at timestamptz NULL,
  author varchar(64) NULL,
  workshop_id varchar(64) NULL,
  display_name varchar(127) NULL,
  world_name varchar(127) NULL,
  world_name_original varchar(127) NULL,
  world_size numeric NULL,
  "location" point NULL,
  CONSTRAINT worlds_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_worlds_deleted_at ON public.worlds USING btree (deleted_at);
-- public.missions definition
-- Drop table
-- DROP TABLE public.missions;
CREATE TABLE public.missions (
  id bigserial NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  deleted_at timestamptz NULL,
  mission_name varchar(200) NULL,
  briefing_name varchar(200) NULL,
  mission_name_source varchar(200) NULL,
  on_load_name varchar(200) NULL,
  author varchar(200) NULL,
  server_name varchar(200) NULL,
  server_profile varchar(200) NULL,
  start_time timestamptz NULL,
  world_id int8 NULL,
  capture_delay numeric NULL DEFAULT 1.000000,
  addon_version varchar(64) NULL DEFAULT '2.0.0'::character varying,
  extension_version varchar(64) NULL DEFAULT '2.0.0'::character varying,
  extension_build varchar(64) NULL DEFAULT '2.0.0'::character varying,
  ocap_recorder_extension_version varchar(64) NULL DEFAULT '1.0.0'::character varying,
  tag varchar(127) NULL,
  CONSTRAINT missions_pkey PRIMARY KEY (id),
  CONSTRAINT fk_worlds_missions FOREIGN KEY (world_id) REFERENCES public.worlds(id)
);
CREATE INDEX idx_mission_start ON public.missions USING btree (start_time);
CREATE INDEX idx_missions_deleted_at ON public.missions USING btree (deleted_at);
-- public.ocap_performances definition
-- Drop table
-- DROP TABLE public.ocap_performances;
CREATE TABLE public.ocap_performances (
  "time" timestamptz NULL,
  mission_id int8 NULL,
  buffer_soldiers int4 NULL,
  buffer_vehicles int4 NULL,
  buffer_soldier_states int4 NULL,
  buffer_vehicle_states int4 NULL,
  buffer_general_events int4 NULL,
  buffer_hit_events int4 NULL,
  buffer_kill_events int4 NULL,
  buffer_fired_events int4 NULL,
  buffer_chat_events int4 NULL,
  buffer_radio_events int4 NULL,
  buffer_server_fps_events int4 NULL,
  writequeue_soldiers int4 NULL,
  writequeue_vehicles int4 NULL,
  writequeue_soldier_states int4 NULL,
  writequeue_vehicle_states int4 NULL,
  writequeue_general_events int4 NULL,
  writequeue_hit_events int4 NULL,
  writequeue_kill_events int4 NULL,
  writequeue_fired_events int4 NULL,
  writequeue_chat_events int4 NULL,
  writequeue_radio_events int4 NULL,
  writequeue_server_fps_events int4 NULL,
  last_write_duration_ms numeric NULL,
  CONSTRAINT fk_ocap_performances_mission FOREIGN KEY (mission_id) REFERENCES public.missions(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_time ON public.ocap_performances USING btree ("time");
-- public.server_fps_events definition
-- Drop table
-- DROP TABLE public.server_fps_events;
CREATE TABLE public.server_fps_events (
  "time" timestamptz NULL,
  mission_id int8 NULL,
  capture_frame int8 NULL,
  fps_average numeric NULL,
  fps_min numeric NULL,
  CONSTRAINT fk_missions_server_fps_events FOREIGN KEY (mission_id) REFERENCES public.missions(id)
);
-- public.soldiers definition
-- Drop table
-- DROP TABLE public.soldiers;
CREATE TABLE public.soldiers (
  id bigserial NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  deleted_at timestamptz NULL,
  mission_id int8 NULL,
  join_time timestamptz NOT NULL,
  join_frame int8 NULL,
  ocap_id int4 NULL,
  ocap_type varchar(16) NULL,
  unit_name varchar(64) NULL,
  group_id varchar(64) NULL,
  side varchar(16) NULL,
  is_player bool NULL DEFAULT false,
  role_description varchar(64) NULL,
  player_uid varchar(64) NULL DEFAULT NULL::character varying,
  class_name varchar(64) NULL DEFAULT NULL::character varying,
  display_name varchar(64) NULL DEFAULT NULL::character varying,
  CONSTRAINT soldiers_pkey PRIMARY KEY (id),
  CONSTRAINT fk_missions_soldiers FOREIGN KEY (mission_id) REFERENCES public.missions(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_join_time ON public.soldiers USING btree (join_time);
CREATE INDEX idx_ocap_id ON public.soldiers USING btree (ocap_id);
CREATE INDEX idx_player_uid ON public.soldiers USING btree (player_uid);
CREATE INDEX idx_soldiers_deleted_at ON public.soldiers USING btree (deleted_at);
-- public.vehicles definition
-- Drop table
-- DROP TABLE public.vehicles;
CREATE TABLE public.vehicles (
  id bigserial NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  deleted_at timestamptz NULL,
  mission_id int8 NULL,
  join_time timestamptz NOT NULL,
  join_frame int8 NULL,
  ocap_id int4 NULL,
  ocap_type varchar(64) NULL,
  class_name varchar(64) NULL,
  display_name varchar(64) NULL,
  customization text NULL,
  CONSTRAINT vehicles_pkey PRIMARY KEY (id),
  CONSTRAINT fk_missions_vehicles FOREIGN KEY (mission_id) REFERENCES public.missions(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_vehicles_deleted_at ON public.vehicles USING btree (deleted_at);
-- public.after_action_reviews definition
-- Drop table
-- DROP TABLE public.after_action_reviews;
CREATE TABLE public.after_action_reviews (
  id bigserial NOT NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  deleted_at timestamptz NULL,
  mission_id int8 NULL,
  author varchar(64) NULL,
  rating numeric NULL,
  comment_good varchar(2000) NULL,
  comment_bad varchar(2000) NULL,
  comment_other varchar(2000) NULL,
  CONSTRAINT after_action_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT fk_after_action_reviews_mission FOREIGN KEY (mission_id) REFERENCES public.missions(id)
);
CREATE INDEX idx_after_action_reviews_deleted_at ON public.after_action_reviews USING btree (deleted_at);
-- public.chat_events definition
-- Drop table
-- DROP TABLE public.chat_events;
CREATE TABLE public.chat_events (
  id bigserial NOT NULL,
  "time" timestamptz NULL,
  mission_id int8 NULL,
  soldier_id int8 NULL,
  capture_frame int8 NULL,
  channel varchar(64) NULL,
  from_name varchar(64) NULL,
  sender_name varchar(64) NULL,
  message text NULL,
  player_uid varchar(64) NULL DEFAULT NULL::character varying,
  CONSTRAINT chat_events_pkey PRIMARY KEY (id),
  CONSTRAINT fk_missions_chat_events FOREIGN KEY (mission_id) REFERENCES public.missions(id),
  CONSTRAINT fk_soldiers_chat_events FOREIGN KEY (soldier_id) REFERENCES public.soldiers(id)
);
-- public.fired_events definition
-- Drop table
-- DROP TABLE public.fired_events;
CREATE TABLE public.fired_events (
  id bigserial NOT NULL,
  "time" timestamptz NULL,
  mission_id int8 NULL,
  soldier_id int8 NULL,
  capture_frame int8 NULL,
  weapon varchar(64) NULL,
  magazine varchar(64) NULL,
  firing_mode varchar(64) NULL,
  start_position point NULL,
  start_elevation_asl numeric NULL,
  end_position point NULL,
  end_elevation_asl numeric NULL,
  CONSTRAINT fired_events_pkey PRIMARY KEY (id),
  CONSTRAINT fk_missions_fired_events FOREIGN KEY (mission_id) REFERENCES public.missions(id),
  CONSTRAINT fk_soldiers_fired_events FOREIGN KEY (soldier_id) REFERENCES public.soldiers(id)
);
-- public.general_events definition
-- Drop table
-- DROP TABLE public.general_events;
CREATE TABLE public.general_events (
  id bigserial NOT NULL,
  "time" timestamptz NULL,
  mission_id int8 NULL,
  capture_frame int8 NULL,
  "name" varchar(64) NULL,
  message text NULL,
  extra_data jsonb NULL DEFAULT '{}'::jsonb,
  CONSTRAINT general_events_pkey PRIMARY KEY (id),
  CONSTRAINT fk_missions_general_events FOREIGN KEY (mission_id) REFERENCES public.missions(id)
);
-- public.hit_events definition
-- Drop table
-- DROP TABLE public.hit_events;
CREATE TABLE public.hit_events (
  id bigserial NOT NULL,
  "time" timestamptz NULL,
  mission_id int8 NULL,
  capture_frame int8 NULL,
  victim_id_soldier int8 NULL,
  victim_id_vehicle int8 NULL,
  shooter_id_soldier int8 NULL,
  shooter_id_vehicle int8 NULL,
  event_text varchar(80) NULL,
  distance numeric NULL,
  CONSTRAINT hit_events_pkey PRIMARY KEY (id),
  CONSTRAINT fk_hit_events_shooter_soldier FOREIGN KEY (shooter_id_soldier) REFERENCES public.soldiers(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_hit_events_shooter_vehicle FOREIGN KEY (shooter_id_vehicle) REFERENCES public.vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_hit_events_victim_soldier FOREIGN KEY (victim_id_soldier) REFERENCES public.soldiers(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_hit_events_victim_vehicle FOREIGN KEY (victim_id_vehicle) REFERENCES public.vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_missions_hit_events FOREIGN KEY (mission_id) REFERENCES public.missions(id)
);
CREATE INDEX idx_shooter_id ON public.hit_events USING btree (shooter_id_soldier, shooter_id_vehicle);
CREATE INDEX idx_victim_id ON public.hit_events USING btree (victim_id_soldier, victim_id_vehicle);
-- public.kill_events definition
-- Drop table
-- DROP TABLE public.kill_events;
CREATE TABLE public.kill_events (
  id bigserial NOT NULL,
  "time" timestamptz NULL,
  mission_id int8 NULL,
  capture_frame int8 NULL,
  victim_id_soldier int8 NULL,
  victim_id_vehicle int8 NULL,
  killer_id_soldier int8 NULL,
  killer_id_vehicle int8 NULL,
  event_text varchar(80) NULL,
  distance numeric NULL,
  CONSTRAINT kill_events_pkey PRIMARY KEY (id),
  CONSTRAINT fk_kill_events_killer_soldier FOREIGN KEY (killer_id_soldier) REFERENCES public.soldiers(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_kill_events_killer_vehicle FOREIGN KEY (killer_id_vehicle) REFERENCES public.vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_kill_events_victim_soldier FOREIGN KEY (victim_id_soldier) REFERENCES public.soldiers(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_kill_events_victim_vehicle FOREIGN KEY (victim_id_vehicle) REFERENCES public.vehicles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_missions_kill_events FOREIGN KEY (mission_id) REFERENCES public.missions(id)
);
CREATE INDEX idx_killer_id ON public.kill_events USING btree (killer_id_soldier, killer_id_vehicle);
-- public.mission_addons definition
-- Drop table
-- DROP TABLE public.mission_addons;
CREATE TABLE public.mission_addons (
  addon_id int8 NOT NULL,
  mission_id int8 NOT NULL,
  CONSTRAINT mission_addons_pkey PRIMARY KEY (addon_id, mission_id),
  CONSTRAINT fk_mission_addons_addon FOREIGN KEY (addon_id) REFERENCES public.addons(id),
  CONSTRAINT fk_mission_addons_mission FOREIGN KEY (mission_id) REFERENCES public.missions(id)
);
-- public.radio_events definition
-- Drop table
-- DROP TABLE public.radio_events;
CREATE TABLE public.radio_events (
  id bigserial NOT NULL,
  "time" timestamptz NULL,
  mission_id int8 NULL,
  soldier_id int8 NULL,
  capture_frame int8 NULL,
  radio varchar(32) NULL,
  radio_type varchar(8) NULL,
  start_end varchar(8) NULL,
  channel int2 NULL,
  is_additional bool NULL,
  frequency numeric NULL,
  code varchar(32) NULL,
  CONSTRAINT radio_events_pkey PRIMARY KEY (id),
  CONSTRAINT fk_missions_radio_events FOREIGN KEY (mission_id) REFERENCES public.missions(id),
  CONSTRAINT fk_soldiers_radio_events FOREIGN KEY (soldier_id) REFERENCES public.soldiers(id)
);
-- public.soldier_states definition
-- Drop table
-- DROP TABLE public.soldier_states;
CREATE TABLE public.soldier_states (
  id bigserial NOT NULL,
  "time" timestamptz NULL,
  mission_id int8 NULL,
  capture_frame int8 NULL,
  soldier_id int8 NULL,
  "position" point NULL,
  elevation_asl numeric NULL,
  bearing int4 NULL DEFAULT 0,
  lifestate int2 NULL DEFAULT 0,
  in_vehicle bool NULL DEFAULT false,
  vehicle_role varchar(64) NULL,
  unit_name varchar(64) NULL,
  is_player bool NULL DEFAULT false,
  "current_role" varchar(64) NULL,
  has_stable_vitals bool NULL DEFAULT true,
  is_dragged_carried bool NULL DEFAULT false,
  scores_infantry_kills int2 NULL,
  scores_vehicle_kills int2 NULL,
  scores_armor_kills int2 NULL,
  scores_air_kills int2 NULL,
  scores_deaths int2 NULL,
  scores_total_score int2 NULL,
  CONSTRAINT soldier_states_pkey PRIMARY KEY (id),
  CONSTRAINT fk_soldier_states_mission FOREIGN KEY (mission_id) REFERENCES public.missions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_soldiers_soldier_states FOREIGN KEY (soldier_id) REFERENCES public.soldiers(id)
);
CREATE INDEX idx_capture_frame ON public.soldier_states USING btree (capture_frame);
CREATE INDEX idx_mission_id ON public.soldier_states USING btree (mission_id);
CREATE INDEX idx_soldier_id ON public.soldier_states USING btree (soldier_id);
-- public.vehicle_states definition
-- Drop table
-- DROP TABLE public.vehicle_states;
CREATE TABLE public.vehicle_states (
  id bigserial NOT NULL,
  "time" timestamptz NULL,
  mission_id int8 NULL,
  capture_frame int8 NULL,
  vehicle_id int8 NULL,
  "position" point NULL,
  elevation_asl numeric NULL,
  bearing int4 NULL,
  is_alive bool NULL,
  crew varchar(128) NULL,
  fuel numeric NULL,
  damage numeric NULL,
  "locked" bool NULL,
  engine_on bool NULL,
  side varchar(16) NULL,
  CONSTRAINT vehicle_states_pkey PRIMARY KEY (id),
  CONSTRAINT fk_vehicle_states_mission FOREIGN KEY (mission_id) REFERENCES public.missions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vehicles_vehicle_states FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
);
CREATE INDEX idx_vehicle_id ON public.vehicle_states USING btree (vehicle_id);