const { addDays, nowISO, todayISO } = require("./dates");
const { createId } = require("./seed");

const COUPON_TYPE = "DAY6_REPURCHASE";
const GROUPS = {
  CONTROL: "CONTROL",
  DAY6_COUPON: "DAY6_COUPON",
};

function ensureList(data) {
  if (!Array.isArray(data.couponEvents)) data.couponEvents = [];
  return data.couponEvents;
}

function experimentGroupForUser(user) {
  const phone = String((user && user.phone) || "");
  const lastDigit = Number(phone.slice(-1));
  if (Number.isFinite(lastDigit)) return lastDigit % 2 === 0 ? GROUPS.CONTROL : GROUPS.DAY6_COUPON;
  const source = String((user && user.user_id) || "");
  const score = source.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return score % 2 === 0 ? GROUPS.CONTROL : GROUPS.DAY6_COUPON;
}

function findCoupon(data, couponId) {
  return ensureList(data).find((item) => item.coupon_id === couponId) || null;
}

function latestCouponForSession(data, sessionId) {
  return ensureList(data)
    .filter((item) => item.session_id === sessionId && item.coupon_type === COUPON_TYPE)
    .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0] || null;
}

function toCouponPayload(coupon) {
  if (!coupon) return null;
  const claimable = coupon.status === "ISSUED";
  const usable = coupon.status === "CLAIMED";
  return {
    couponId: coupon.coupon_id,
    couponType: coupon.coupon_type,
    experimentGroup: coupon.experiment_group,
    status: coupon.status,
    title: coupon.title,
    description: coupon.description,
    discountText: coupon.discount_text,
    code: coupon.code || "",
    issuedAt: coupon.issued_at || "",
    claimedAt: coupon.claimed_at || "",
    usedAt: coupon.used_at || "",
    expiresAt: coupon.expires_at || "",
    repurchaseClickedAt: coupon.repurchase_clicked_at || "",
    claimable,
    usable,
    visible: coupon.experiment_group === GROUPS.DAY6_COUPON && coupon.status !== "CONTROL",
  };
}

function triggerCoupon(data, user, session, reason = "DAY6_CHECKIN", dateText = todayISO()) {
  const existing = latestCouponForSession(data, session.session_id);
  if (existing) return { coupon: existing, created: false };

  const group = experimentGroupForUser(user);
  const coupon = {
    coupon_id: createId("cpn"),
    user_id: user.user_id,
    session_id: session.session_id,
    order_id: session.order_id || "",
    coupon_type: COUPON_TYPE,
    experiment_group: group,
    status: group === GROUPS.DAY6_COUPON ? "ISSUED" : "CONTROL",
    reason,
    title: "ROOT Day6 复购礼",
    description: "完成第6天记录后解锁，领取后可前往店铺使用。",
    discount_text: "复购专属券",
    code: group === GROUPS.DAY6_COUPON ? `ROOT${String(Date.now()).slice(-6)}` : "",
    issued_at: nowISO(),
    claimed_at: "",
    used_at: "",
    expires_at: addDays(dateText, 14),
    repurchase_clicked_at: "",
    created_at: nowISO(),
  };
  ensureList(data).push(coupon);
  return { coupon, created: true };
}

function claimCoupon(data, userId, couponId) {
  const coupon = findCoupon(data, couponId);
  if (!coupon || coupon.user_id !== userId) {
    const error = new Error("优惠券不存在");
    error.code = 7001;
    throw error;
  }
  if (coupon.status === "CONTROL") {
    const error = new Error("当前实验组没有可领取优惠券");
    error.code = 7002;
    throw error;
  }
  if (coupon.status === "ISSUED") {
    coupon.status = "CLAIMED";
    coupon.claimed_at = nowISO();
  }
  return coupon;
}

function markCouponUsed(data, couponId) {
  const coupon = findCoupon(data, couponId);
  if (!coupon) {
    const error = new Error("优惠券不存在");
    error.code = 7001;
    error.status = 404;
    throw error;
  }
  if (coupon.status !== "USED") {
    coupon.status = "USED";
    coupon.used_at = nowISO();
  }
  return coupon;
}

function markRepurchaseClick(data, userId, couponId) {
  const coupon = findCoupon(data, couponId);
  if (!coupon || coupon.user_id !== userId) {
    const error = new Error("优惠券不存在");
    error.code = 7001;
    throw error;
  }
  coupon.repurchase_clicked_at = coupon.repurchase_clicked_at || nowISO();
  return coupon;
}

function getCouponStatus(data, user, session) {
  const group = experimentGroupForUser(user);
  const coupon = session ? latestCouponForSession(data, session.session_id) : null;
  return {
    experimentGroup: coupon ? coupon.experiment_group : group,
    coupon: toCouponPayload(coupon),
    visible: Boolean(coupon && coupon.experiment_group === GROUPS.DAY6_COUPON && coupon.status !== "CONTROL"),
  };
}

function buildCouponSummary(data) {
  const events = ensureList(data);
  const byGroup = Object.values(GROUPS).reduce((result, group) => {
    const groupEvents = events.filter((item) => item.experiment_group === group);
    const issued = groupEvents.filter((item) => item.status !== "CONTROL").length;
    const claimed = groupEvents.filter((item) => ["CLAIMED", "USED"].includes(item.status)).length;
    const used = groupEvents.filter((item) => item.status === "USED").length;
    const repurchaseClicks = groupEvents.filter((item) => item.repurchase_clicked_at).length;
    result[group] = {
      users: groupEvents.length,
      issued,
      claimed,
      used,
      repurchaseClicks,
      claimRate: issued ? Math.round((claimed / issued) * 100) : 0,
      useRate: claimed ? Math.round((used / claimed) * 100) : 0,
    };
    return result;
  }, {});
  return {
    total: events.length,
    byGroup,
    issued: events.filter((item) => item.status !== "CONTROL").length,
    claimed: events.filter((item) => ["CLAIMED", "USED"].includes(item.status)).length,
    used: events.filter((item) => item.status === "USED").length,
    repurchaseClicks: events.filter((item) => item.repurchase_clicked_at).length,
  };
}

module.exports = {
  COUPON_TYPE,
  GROUPS,
  buildCouponSummary,
  claimCoupon,
  experimentGroupForUser,
  getCouponStatus,
  markCouponUsed,
  markRepurchaseClick,
  toCouponPayload,
  triggerCoupon,
};
