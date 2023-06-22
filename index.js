import { http } from "@google-cloud/functions-framework";
import { DNS } from "@google-cloud/dns";

if (!process.env.DYNDNS_USER || !process.env.DYNDNS_PASS) {
  throw new Error(
    "Credentials are not set up correctly. Please fill the environment variables DYNDNS_USER and DYNDNS_PASS."
  );
}

if (!process.env.ZONE) {
  throw new Error("No zone specified. Please fill the environment variable ZONE.");
}

// Create a client
const dns = new DNS();

http("update", async (req, res) => {
  // Check for Basic Authentication header
  if (!req.headers.authorization || req.headers.authorization.indexOf("Basic ") === -1) {
    console.error("Missing authentication header");
    return res.status(401).send("badauth");
  }

  // Verify Authentication Credentials
  const base64Credentials = req.headers.authorization.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("ascii");
  const [username, password] = credentials.split(":");
  if (process.env.DYNDNS_USER !== username || process.env.DYNDNS_PASS !== password) {
    console.error("Invalid credentials");
    return res.status(401).send("badauth");
  }

  // Read query parameter
  const { hostname, myip } = req.query;
  const hostnameWithDot = hostname + ".";
  if (typeof myip !== "string") {
    console.error("Wrong type of myip entry");
    return res.status(400).send("badagent");
  }
  const ips = myip.split(",");
  const newIPv4 = ips.find((ip) => ip.includes("."));
  const newIPv6 = ips.find((ip) => ip.includes(":"));

  // Get existing records
  //
  // object 0 is record list matching hostname and type (only 1 allowed)
  // use record 0
  // .data is list of values
  // use value 0 (we expect only 1)
  const zone = dns.zone(process.env.ZONE);
  let existingIPv4, existingIPv6, existingIPv4Record, existingIPv6Record;
  try {
    existingIPv4Record = (await zone.getRecords({ name: hostnameWithDot, type: "A" }))[0][0];
    existingIPv4 = existingIPv4Record.data[0];
  } catch (_) {
    existingIPv4Record = undefined;
    existingIPv4 = undefined;
  }
  try {
    existingIPv6Record = (await zone.getRecords({ name: hostnameWithDot, type: "AAAA" }))[0][0];
    existingIPv6 = existingIPv6Record.data[0];
  } catch (_) {
    existingIPv6Record = undefined;
    existingIPv6 = undefined;
  }

  // If no A or AAAA record exists, the hostname cannot be used.
  if (existingIPv4 === undefined && existingIPv6 === undefined) {
    console.error(`${hostname}: The hostname does not exist`);
    return res.status(404).send("nohost");
  }

  // No change
  if (newIPv4 === existingIPv4 && newIPv6 === existingIPv6) {
    console.log(`${hostname}: No change`);
    return res.status(200).send("nochg");
  }

  // Change in IPv4
  if (newIPv4 && existingIPv4 && newIPv4 !== existingIPv4) {
    console.log(`${hostname}: Changing A record from ${existingIPv4} to ${newIPv4}`);
    const newIPv4Record = zone.record("A", {
      name: hostnameWithDot,
      data: [newIPv4],
      ttl: 60,
    });
    try {
      await zone.createChange({
        delete: existingIPv4Record,
        add: newIPv4Record,
      });
    } catch (e) {
      console.error(e);
      return res.status(502).send("dnserr");
    }
  }

  // Change in IPv6
  if (newIPv6 && existingIPv6 && newIPv6 !== existingIPv6) {
    console.log(`${hostname}: Changing AAAA record from ${existingIPv6} to ${newIPv6}`);
    const newIPv6Record = zone.record("AAAA", {
      name: hostnameWithDot,
      data: [newIPv6],
      ttl: 60,
    });
    try {
      await zone.createChange({
        delete: existingIPv6Record,
        add: newIPv6Record,
      });
    } catch (e) {
      console.error(e);
      return res.status(502).send("dnserr");
    }
  }

  return res.status(200).send(`good ${[newIPv4, newIPv6].filter((ip) => ip).join(", ")}`);

  // return res.status(501).send('911');
});
