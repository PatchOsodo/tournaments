/**
 * =============================================================================
 * migrate_teams.js
 * One-time migration script — run once in the browser console on index.html.
 *
 * WHAT IT DOES
 * ------------
 * Migrates existing master_teams records from the old single `category` text
 * field (e.g. "U16 Boys") to the new separate `gender` and `age_group` fields.
 *
 * BEFORE RUNNING
 * --------------
 * 1. Add these two fields to the master_teams collection in PocketBase admin:
 *    - gender    : Select  (options: Boys, Girls, Mixed)
 *    - age_group : Text
 * 2. The old `category` field can be kept temporarily for safety, deleted later.
 *
 * HOW TO RUN
 * ----------
 * Paste the entire contents of this file into the browser console on index.html
 * while logged in as super_admin, then press Enter.
 * =============================================================================
 */
(async () => {
  console.log('=== master_teams migration starting ===');

  // Known age group patterns to parse from old category strings
  const AGE_GROUP_PATTERNS = [
    /^(U\d+)\s+(Boys|Girls|Mixed)$/i,   // "U16 Boys", "U13 Girls"
    /^(Boys|Girls|Mixed)\s+(U\d+)$/i,   // "Boys U16"
    /^(Senior)\s+(Boys|Girls|Mixed)$/i, // "Senior Boys"
    /^(Boys|Girls|Mixed)\s+(Senior)$/i, // "Boys Senior"
  ];

  function parseCategory(category) {
    if (!category) return { gender: null, age_group: null };

    const trimmed = category.trim();

    for (const pattern of AGE_GROUP_PATTERNS) {
      const match = trimmed.match(pattern);
      if (match) {
        // Determine which capture group is the age/gender
        const g1Lower = match[1].toLowerCase();
        const isGender1 = ['boys','girls','mixed','senior'].some(g => g1Lower.startsWith(g));

        if (isGender1) {
          return {
            gender    : capitalise(match[1]),
            age_group : match[2].toUpperCase(),
          };
        } else {
          return {
            gender    : capitalise(match[2]),
            age_group : match[1].toUpperCase(),
          };
        }
      }
    }

    // Fallback — couldn't parse, store whole string as age_group
    console.warn('  Could not parse category:', trimmed, '— storing as age_group');
    return { gender: null, age_group: trimmed };
  }

  function capitalise(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  try {
    const teams = await pb.collection('master_teams').getFullList({
      requestKey: null,
    });

    console.log(`Found ${teams.length} master_teams records`);

    let updated = 0;
    let skipped = 0;

    for (const team of teams) {
      // Skip if already migrated
      if (team.gender || team.age_group) {
        console.log(`  Skipping (already has gender/age_group): ${team.name}`);
        skipped++;
        continue;
      }

      const { gender, age_group } = parseCategory(team.category);

      console.log(`  ${team.name} — category: "${team.category || ''}" → gender: "${gender || ''}", age_group: "${age_group || ''}"`);

      await pb.collection('master_teams').update(team.id, {
        gender    : gender    || null,
        age_group : age_group || null,
      });
      updated++;
    }

    console.log(`\n=== Migration complete ===`);
    console.log(`  Updated : ${updated}`);
    console.log(`  Skipped : ${skipped}`);
    console.log(`\nNext step: verify the data in /_/ then remove the old 'category' field.`);

  } catch (e) {
    console.error('Migration failed:', e.message);
    console.error('Make sure gender and age_group fields exist on master_teams first.');
  }
})();
