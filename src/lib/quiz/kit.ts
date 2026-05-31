export async function subscribeToKit(email: string): Promise<boolean> {
  if (!email) return false;
  try {
    const res = await fetch("/api/kit-subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return res.ok;
  } catch (err) {
    console.error("Kit subscribe error:", err);
    return false;
  }
}
