require("dotenv").config();
const core = require("@huaweicloud/huaweicloud-sdk-core");
const rds = require("@huaweicloud/huaweicloud-sdk-rds/v3/public-api");
const smn = require("@huaweicloud/huaweicloud-sdk-smn/v2/public-api");

const CONFIG = {
  ak: process.env.CLOUD_SDK_AK || "",
  sk: process.env.CLOUD_SDK_SK || "",
  projectId: process.env.CLOUD_PROJECT_ID || "",
  rdsEndpoint: "https://rds.tr-west-1.myhuaweicloud.com",
  smnEndpoint: "https://smn.tr-west-1.myhuaweicloud.com",
  smnTopicUrn: process.env.SMN_TOPIC_URN || "",
  instanceId: process.env.RDS_INSTANCE_ID || "",
};

function buildCredentials() {
  return new core.BasicCredentials()
    .withAk(CONFIG.ak)
    .withSk(CONFIG.sk)
    .withProjectId(CONFIG.projectId);
}

function createRdsClient() {
  return rds.RdsClient.newBuilder()
    .withCredential(buildCredentials())
    .withEndpoint(CONFIG.rdsEndpoint)
    .build();
}

function createSmnClient() {
  return smn.SmnClient.newBuilder()
    .withCredential(buildCredentials())
    .withEndpoint(CONFIG.smnEndpoint)
    .build();
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

function formatSize(kb) {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(2)} MB`;
  return `${kb} KB`;
}

function toTRTime(dateStr) {
  return new Date(dateStr).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function backupTypeName(type) {
  const types = { auto: "Automatic", manual: "Manual", incremental: "Incremental" };
  return types[type] || type;
}

function buildNotificationMessage(backup) {
  const date = new Date().toLocaleDateString("tr-TR", {
    timeZone: "Europe/Istanbul",
  });
  const isHealthy = backup.status === "COMPLETED";
  const icon = isHealthy ? "\u2705" : "\u274c";
  const statusText = isHealthy ? "SUCCESS" : "FAILED";
  const line = "\u2500".repeat(40);

  return (
    `Huawei Cloud RDS SQL Server - Daily Backup Report\n` +
    `${line}\n\n` +
    `${icon} Status    : ${statusText}\n\n` +
    `Date      : ${date}\n` +
    `Instance  : ${CONFIG.instanceId}\n` +
    `Engine    : ${backup.datastore?.type || "-"} ${backup.datastore?.version || ""}\n` +
    `Type      : ${backupTypeName(backup.type)}\n` +
    `Size      : ${formatSize(backup.size)}\n` +
    `Started   : ${toTRTime(backup.begin_time)}\n` +
    `Finished  : ${toTRTime(backup.end_time)}\n\n` +
    `${line}`
  );
}

async function fetchLatestTodayBackup(client) {
  const request = new rds.ListBackupsRequest();
  request.instanceId = CONFIG.instanceId;

  const result = await client.listBackups(request);

  const todayBackups = (result.backups || []).filter((b) => isToday(b.begin_time));

  if (todayBackups.length === 0) return null;

  return todayBackups.sort(
    (a, b) => new Date(b.begin_time) - new Date(a.begin_time)
  )[0];
}

async function sendNotification(client, subject, message) {
  const request = new smn.PublishMessageRequest();
  request.topicUrn = CONFIG.smnTopicUrn;
  request.body = new smn.PublishMessageRequestBody()
    .withSubject(subject)
    .withMessage(message);

  return client.publishMessage(request);
}

exports.handler = async function (event, context) {
  const rdsClient = createRdsClient();
  const smnClient = createSmnClient();

  const backup = await fetchLatestTodayBackup(rdsClient);

  if (!backup) {
    console.log("No backups found for today. Skipping notification.");
    return { statusCode: 200, body: "No backups found for today." };
  }

  const isHealthy = backup.status === "COMPLETED";
  const subject = isHealthy
    ? "Huawei Cloud RDS SQL Server - Backup Successful"
    : "Huawei Cloud RDS SQL Server - Backup Failed";

  console.log(`Latest backup status: ${backup.status}. Sending notification...`);

  const message = buildNotificationMessage(backup);
  const result = await sendNotification(smnClient, subject, message);

  console.log("Notification sent.", JSON.stringify(result, null, 2));
  return { statusCode: 200, body: result };
};
