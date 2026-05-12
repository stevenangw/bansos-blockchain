// Truncate blockchain address
export function truncateAddress(addr, start = 6, end = 4) {
  if (!addr || addr.length < start + end + 2) return addr || "";
  return `${addr.slice(0, start)}...${addr.slice(-end)}`;
}

// Format Unix Timestamp
export function formatTimestamp(unixTime) {
  if (!unixTime) return "-";
  const date = new Date(unixTime * 1000);
  return date.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Format token amount
export function formatAmount(amount) {
  if (amount === undefined || amount === null) return "0";
  return Number(amount).toLocaleString("id-ID");
}
