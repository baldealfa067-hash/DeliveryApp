-- Adjust the provisioned AK House pilot without creating a job in unconfigured environments.
SELECT cron.alter_job(jobid, schedule := '15 seconds')
FROM cron.job
WHERE jobname = 'sync-gestao-pro-ak-house'
  AND schedule = '* * * * *';
