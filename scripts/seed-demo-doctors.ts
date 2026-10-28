import pg from "pg";
import { departmentSeeds } from "../lib/db/seed-data";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Set DATABASE_URL to your local PostgreSQL connection before running this seed.");
}

const parsedUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("Demo doctors can only be seeded into a local database.");
}
parsedUrl.searchParams.delete("schema");

const pool = new Pool({ connectionString: parsedUrl.toString() });

const demoNames = ["Aarav Mehta", "Mira Kapoor", "Kabir Rao"];
const degrees = ["MBBS, MD", "MBBS, DNB", "MBBS, MS"];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [departmentName, slug] of departmentSeeds) {
      await client.query(
        `INSERT INTO departments (name, slug) VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name`,
        [departmentName, slug],
      );
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM departments WHERE slug = $1",
        [slug],
      );
      const departmentId = rows[0]?.id;
      if (!departmentId) throw new Error(`Could not find department ${departmentName}.`);

      for (let index = 0; index < demoNames.length; index += 1) {
        const suffix = String(index + 1).padStart(2, "0");
        const userId = `demo-doctor-${slug}-${suffix}`;
        const fullName = `Demo Dr. ${demoNames[index]}`;
        const email = `${userId}@example.invalid`;

        await client.query(
          `INSERT INTO "user" (id, name, email, role, email_verified)
           VALUES ($1, $2, $3, 'doctor', TRUE)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = 'doctor'`,
          [userId, fullName, email],
        );
        const profileResult = await client.query<{ id: string }>(
          `INSERT INTO doctor_profiles (
             user_id, full_name, phone, city, state, bio, registration_number,
             registration_council, registration_year, department_id, sub_specialties,
             qualifications, years_experience, clinic_name, clinic_address, languages,
             consult_modes, fee_inr, time_zone, slot_minutes, buffer_minutes,
             onboarding_step, verification_status, verified_at
           ) VALUES (
             $1, $2, $3, 'Ghaziabad', 'Uttar Pradesh', $4, $5, $6, $7, $8,
             $9::jsonb, $10::jsonb, $11, 'Health Bridge Demo Clinic',
             'Demo listing only', $12::jsonb, $13::jsonb, $14, 'Asia/Kolkata',
             15, 0, 7, 'verified', NOW()
           )
           ON CONFLICT (user_id) DO UPDATE SET
             full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, city = EXCLUDED.city,
             state = EXCLUDED.state, bio = EXCLUDED.bio,
             registration_number = EXCLUDED.registration_number,
             registration_council = EXCLUDED.registration_council,
             registration_year = EXCLUDED.registration_year,
             department_id = EXCLUDED.department_id, sub_specialties = EXCLUDED.sub_specialties,
             qualifications = EXCLUDED.qualifications, years_experience = EXCLUDED.years_experience,
             clinic_name = EXCLUDED.clinic_name, clinic_address = EXCLUDED.clinic_address,
             languages = EXCLUDED.languages, consult_modes = EXCLUDED.consult_modes,
             fee_inr = EXCLUDED.fee_inr, time_zone = EXCLUDED.time_zone,
             slot_minutes = EXCLUDED.slot_minutes, buffer_minutes = EXCLUDED.buffer_minutes,
             onboarding_step = 7, verification_status = 'verified', verified_at = NOW()
           RETURNING id`,
          [
            userId,
            fullName,
            `+919100000${suffix}`,
            `DEMO DATA ONLY. Fictional ${departmentName.toLowerCase()} listing for local development; this is not a real clinician or medical service.`,
            `DEMO-${slug.toUpperCase()}-${suffix}`,
            "Demo Medical Council",
            2020,
            departmentId,
            JSON.stringify([`${departmentName} (demo)`]),
            JSON.stringify([{ degree: degrees[index], institution: "Demo Medical Institute", year: 2016 + index }]),
            [2, 4, 6][index],
            JSON.stringify(["English", "Hindi"]),
            JSON.stringify(["video", "audio"]),
            300 + index * 100,
          ],
        );
        const doctorId = profileResult.rows[0]?.id;
        if (!doctorId) throw new Error(`Could not create demo profile for ${userId}.`);

        for (const weekday of [1, 2, 3, 4, 5]) {
          await client.query(
            `INSERT INTO doctor_availability_rules (doctor_id, weekday, start_time, end_time)
             VALUES ($1, $2, '09:00', '17:00')
             ON CONFLICT (doctor_id, weekday, start_time, end_time) DO NOTHING`,
            [doctorId, weekday],
          );
        }
      }
    }

    await client.query("COMMIT");
    console.info(`Seeded ${departmentSeeds.length * demoNames.length} clearly labeled demo doctors across ${departmentSeeds.length} specialties.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Demo doctor seed failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
