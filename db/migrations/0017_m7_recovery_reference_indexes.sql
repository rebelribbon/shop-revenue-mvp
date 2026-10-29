CREATE INDEX recommendation_customer_vehicle_idx ON app.recommendation(business_id,customer_id,vehicle_id);
CREATE INDEX recommendation_creator_idx ON app.recommendation(created_by_user_id);
CREATE INDEX recovery_item_customer_vehicle_idx ON app.recovery_item(business_id,customer_id,vehicle_id);
CREATE INDEX recovery_item_creator_idx ON app.recovery_item(created_by_user_id);
CREATE INDEX estimate_recovery_source_idx ON app.estimate_version(business_id,source_recovery_item_id);
CREATE INDEX appointment_recovery_source_idx ON app.appointment(business_id,source_recovery_item_id);
