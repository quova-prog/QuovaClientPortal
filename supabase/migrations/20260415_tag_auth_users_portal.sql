-- Tag auth.users with app_metadata.portal so support vs app users
-- are distinguishable in the Supabase Auth dashboard.

-- Tag support users
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"portal": "support"}'::jsonb
WHERE id IN (SELECT id FROM public.support_users);

-- Tag app users (everyone else)
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"portal": "app"}'::jsonb
WHERE id NOT IN (SELECT id FROM public.support_users);
