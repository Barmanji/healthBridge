import { hashPassword } from "better-auth/crypto";
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

const doctorsPerDepartment = 3;
const degrees = ["MBBS, MD", "MBBS, DNB", "MBBS, MS"];
/** Shared password for every seeded demo doctor, so they can actually sign in. */
const demoPassword = "Speed12345@";
// One distinct name and portrait per seeded doctor. Placeholder portraits for local
// demos only — replace with real, consented photos before any non-local use.
const demoDoctors = [
  { name: "Dr. Aarav Mehta", photo: "https://randomuser.me/api/portraits/men/1.jpg" },
  { name: "Dr. Mira Kapoor", photo: "https://randomuser.me/api/portraits/women/2.jpg" },
  { name: "Dr. Kabir Rao", photo: "https://randomuser.me/api/portraits/men/3.jpg" },
  { name: "Dr. Ananya Iyer", photo: "https://randomuser.me/api/portraits/women/4.jpg" },
  { name: "Dr. Rohan Deshmukh", photo: "https://randomuser.me/api/portraits/men/5.jpg" },
  { name: "Dr. Priya Nair", photo: "https://randomuser.me/api/portraits/women/6.jpg" },
  { name: "Dr. Vikram Sethi", photo: "https://randomuser.me/api/portraits/men/7.jpg" },
  { name: "Dr. Sneha Kulkarni", photo: "https://randomuser.me/api/portraits/women/9.jpg" },
  { name: "Dr. Arjun Menon", photo: "https://randomuser.me/api/portraits/men/11.jpg" },
  { name: "Dr. Divya Reddy", photo: "https://randomuser.me/api/portraits/women/12.jpg" },
  { name: "Dr. Nikhil Bansal", photo: "https://randomuser.me/api/portraits/men/13.jpg" },
  { name: "Dr. Kavya Pillai", photo: "https://randomuser.me/api/portraits/women/15.jpg" },
  { name: "Dr. Siddharth Joshi", photo: "https://randomuser.me/api/portraits/men/17.jpg" },
  { name: "Dr. Ritu Agarwal", photo: "https://randomuser.me/api/portraits/women/18.jpg" },
  { name: "Dr. Manish Chauhan", photo: "https://randomuser.me/api/portraits/men/21.jpg" },
  { name: "Dr. Pooja Bhat", photo: "https://randomuser.me/api/portraits/women/23.jpg" },
  { name: "Dr. Aditya Verma", photo: "https://randomuser.me/api/portraits/men/25.jpg" },
  { name: "Dr. Neha Saxena", photo: "https://randomuser.me/api/portraits/women/26.jpg" },
  { name: "Dr. Rahul Gupta", photo: "https://randomuser.me/api/portraits/men/28.jpg" },
  { name: "Dr. Shreya Bhattacharya", photo: "https://randomuser.me/api/portraits/women/30.jpg" },
  { name: "Dr. Karan Malhotra", photo: "https://randomuser.me/api/portraits/men/32.jpg" },
  { name: "Dr. Tanvi Shetty", photo: "https://randomuser.me/api/portraits/women/33.jpg" },
  { name: "Dr. Amit Trivedi", photo: "https://randomuser.me/api/portraits/men/36.jpg" },
  { name: "Dr. Ishita Ghosh", photo: "https://randomuser.me/api/portraits/women/38.jpg" },
  { name: "Dr. Suresh Patil", photo: "https://randomuser.me/api/portraits/men/41.jpg" },
  { name: "Dr. Meera Ranganathan", photo: "https://randomuser.me/api/portraits/women/42.jpg" },
  { name: "Dr. Harsh Vardhan", photo: "https://randomuser.me/api/portraits/men/45.jpg" },
  { name: "Dr. Aditi Sinha", photo: "https://randomuser.me/api/portraits/women/47.jpg" },
  { name: "Dr. Nandini Rao", photo: "https://randomuser.me/api/portraits/women/51.jpg" },
  { name: "Dr. Prashant Sandhu", photo: "https://randomuser.me/api/portraits/men/52.jpg" },
  { name: "Dr. Lavanya Krishnan", photo: "https://randomuser.me/api/portraits/women/55.jpg" },
  { name: "Dr. Gaurav Yadav", photo: "https://randomuser.me/api/portraits/men/56.jpg" },
  { name: "Dr. Zoya Khan", photo: "https://randomuser.me/api/portraits/women/58.jpg" },
  { name: "Dr. Sameer Qureshi", photo: "https://randomuser.me/api/portraits/men/60.jpg" },
  { name: "Dr. Rhea D'Souza", photo: "https://randomuser.me/api/portraits/women/63.jpg" },
  { name: "Dr. Deepak Naik", photo: "https://randomuser.me/api/portraits/men/65.jpg" },
];

/** "Dr. Manish Chauhan" → manishchauhan@gmail.com */
function demoEmail(name: string) {
  const localPart = name.replace(/^Dr\.\s*/i, "").replace(/[^A-Za-z0-9]/g, "");
  // Better Auth lowercases the email before looking the user up, so mixed-case
  // typing only works when the stored value is lowercase too.
  return `${localPart}@gmail.com`.toLowerCase();
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [departmentIndex, [departmentName, slug]] of departmentSeeds.entries()) {
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

      for (let index = 0; index < doctorsPerDepartment; index += 1) {
        const person = demoDoctors[departmentIndex * doctorsPerDepartment + index];
        if (!person) throw new Error(`No demo doctor configured for ${departmentName} slot ${index + 1}.`);
        const suffix = String(index + 1).padStart(2, "0");
        const userId = `demo-doctor-${slug}-${suffix}`;
        const fullName = person.name;
        const email = demoEmail(person.name);

        await client.query(
          `INSERT INTO "user" (id, name, email, role, email_verified, image)
           VALUES ($1, $2, $3, 'doctor', TRUE, $4)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = 'doctor', image = EXCLUDED.image`,
          [userId, fullName, email, person.photo],
        );
        // Credential account so the demo doctors can sign in with email + password.
        await client.query(
          `INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at)
           VALUES ($1, $2, 'credential', $2, $3, NOW())
           ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password, updated_at = NOW()`,
          [`demo-account-${userId}`, userId, await hashPassword(demoPassword)],
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
             $9::jsonb, $10::jsonb, $11, 'Health Bridge Clinic',
             'Local demo profile', $12::jsonb, $13::jsonb, $14, 'Asia/Kolkata',
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
            `Consultant ${departmentName.toLowerCase()} at Health Bridge Clinic, Ghaziabad. Fictional profile seeded for local development — not a real person or medical service.`,
            `HB-${slug.toUpperCase()}-${suffix}`,
            "NCR Medical Council",
            2020,
            departmentId,
            JSON.stringify([`${departmentName} (demo)`]),
            JSON.stringify([{ degree: degrees[index], institution: "NCR Medical Institute", year: 2016 + index }]),
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
    console.info(`Seeded ${demoDoctors.length} demo doctors across ${departmentSeeds.length} specialties.`);
    console.info(`Sign in as <FirstName><LastName>@gmail.com (e.g. ${demoEmail(demoDoctors[0]!.name)}, ${demoEmail(demoDoctors[14]!.name)}) — password: ${demoPassword}`);
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
