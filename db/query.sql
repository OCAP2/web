-- name: GetMissions :many
-- desc: Get all missions
Select *
FROM missions;
-- name: GetMissionById :one
-- desc: Get mission by id
with sstates as (
  select mission_id,
    MAX(capture_frame) as last_frame
  from soldier_states
  group by mission_id
),
all_addons as (
  select a.id,
    a.name,
    a.workshop_id
  from addons a
  order by a.name asc
)
select m.*,
  MAX(sstates.last_frame) as last_frame,
  array_agg(
    json_build_object(
      'addonName',
      ad.name,
      'workshopId',
      ad.workshop_id
    )
  ) as mods
from missions m
  left join sstates on sstates.mission_id = m.id
  left join all_addons ad on ad.id in (
    select addon_id
    from mission_addons
    where mission_id = @mission_id::int
  )
where m.id = @mission_id::int
group by m.id;
-- name: GetWorlds :many
-- desc: Get all worlds
Select *
FROM worlds;
-- name: GetWorldById :one
-- desc: Get world by id
Select *
FROM worlds
WHERE id = @world_id::int;
-- name: GetEntities :many
-- desc: Get all entities from a mission
Select id,
  ocap_id,
  ocap_type
FROM soldiers
WHERE mission_id = @mission_id::int
UNION
Select id,
  ocap_id,
  ocap_type
from vehicles
WHERE mission_id = @mission_id::int;
-- name: GetSoldierByOcapId :one
-- desc: Get soldier by ocap id
Select *
FROM soldiers
WHERE mission_id = @mission_id::int
  and ocap_id = @ocap_id::int;
-- name: GetSoldierStates :many
-- desc: Get soldier states by mission id and ocap id
with ss as (
  select *
  from soldier_states
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
select s2.*
from soldiers s
  left join ss s2 on s.id = s2.soldier_id
where s.mission_id = @mission_id::int
  and s.ocap_id = @ocap_id::int;
-- name: GetFiredEvents :many
-- desc: Get fired events by mission id and ocap id
with fired_events AS (
  select *
  from fired_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select fe.*
from soldiers s
  left join fired_events fe on s.id = fe.soldier_id
where s.mission_id = @mission_id::int
  and s.ocap_id = @ocap_id::int;
-- name: GetKillEvents :many
-- desc: Get kill events by mission id
with kill_events as (
  select *
  from kill_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select ke.*
from soldiers s
  left join kill_events ke on s.id IN (ke.victim_id_soldier, ke.killer_id_soldier)
where s.mission_id = @mission_id::int
  and s.ocap_id = @ocap_id::int;
-- name: GetHitEvents :many
-- desc: Get hit events by mission id
with hit_events as (
  select *
  from hit_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select he.*
from soldiers s
  left join hit_events he on s.id IN (he.victim_id_soldier, he.shooter_id_soldier)
where s.mission_id = @mission_id::int
  and s.ocap_id = @ocap_id::int;
-- name: GetChatEvents :many
-- desc: Get chat events by mission id
with chat_events as (
  select *
  from chat_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select ce.*
from soldiers s
  left join chat_events ce on s.id = ce.soldier_id
where s.mission_id = @mission_id::int
  and s.ocap_id = @ocap_id::int;
-- name: GetRadioEvents :many
-- desc: Get radio events by mission id
with radio_events as (
  select *
  from radio_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select re.*
from soldiers s
  left join radio_events re on s.id = re.soldier_id
where s.mission_id = @mission_id::int
  and s.ocap_id = @ocap_id::int;
-- name: GetSoldierById :one
-- desc: Get soldier by ocap id
Select *
FROM soldiers
WHERE mission_id = @mission_id::int
  and ocap_id = @ocap_id::int;
-- name: GetVehicleByOcapId :one
-- desc: Get vehicle by ocap id
Select *
FROM vehicles
WHERE mission_id = @mission_id::int
  and ocap_id = @ocap_id::int;
-- name: GetVehicleStates :many
-- desc: Get vehicle states by mission id and ocap id
with vs as (
  select *
  from vehicle_states
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
select v2.*
from vehicles v
  left join vs v2 on v.id = v2.vehicle_id
where v.mission_id = @mission_id::int
  and v.ocap_id = @ocap_id::int;
-- name: GetVehicleHitEvents :many
-- desc: Get vehicle hit events by mission id
with he as (
  select *
  from hit_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select he.*
from vehicles v
  left join he on v.id = he.vehicle_id
where v.mission_id = @mission_id::int
  and v.ocap_id = @ocap_id::int;
-- name: GetVehicleKillEvents :many
-- desc: Get vehicle kill events by mission id
with ke as (
  select *
  from kill_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select ke.*
FROM vehicles v
  left join ke on v.id IN (ke.victim_id_vehicle, ke.killer_id_vehicle)
where v.mission_id = @mission_id::int
  and v.ocap_id = @ocap_id::int;
-- name: GetOtherChatEvents :many
-- desc: Get other chat events by mission id
with chat_events as (
  select *
  from chat_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select ce.*
from chat_events ce
where ce.soldier_id IS NULL
  and ce.mission_id = @mission_id::int;
-- name: GetOtherRadioEvents :many
-- desc: Get other radio events by mission id
with radio_events as (
  select *
  from radio_events
  where mission_id = @mission_id::int
    and capture_frame BETWEEN @start_frame::int AND @end_frame::int
  order by capture_frame asc
)
Select re.*
from radio_events re
where re.soldier_id IS NULL
  and re.mission_id = @mission_id::int;
-- name: GetServerFpsEvents :many
-- desc: Get server fps events by mission id
Select sfe.*
from server_fps_events sfe
where sfe.mission_id = @mission_id::int
order by capture_frame asc;