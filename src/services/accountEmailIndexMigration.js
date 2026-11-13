import Donante from "../models/Donante.js";
import Recolector from "../models/Recolector.js";

const EMAIL_ROLE_INDEX = { email: 1, rol: 1 };
const EMAIL_NORMALIZATION_PIPELINE = [
  {
    $set: {
      email: { $toLower: { $trim: { input: "$email" } } },
    },
  },
];

const hasIndexKeys = (index, expected) => {
  const keys = Object.entries(index.key || {});
  const expectedEntries = Object.entries(expected);
  return keys.length === expectedEntries.length &&
    keys.every(([key, direction], position) =>
      key === expectedEntries[position][0] &&
      direction === expectedEntries[position][1]
    );
};

const isLegacyUniqueEmailIndex = (index) =>
  index.unique === true && hasIndexKeys(index, { email: 1 });

const isCompatibleEmailRoleIndex = (index) =>
  index.unique === true &&
  index.sparse !== true &&
  !index.partialFilterExpression &&
  hasIndexKeys(index, EMAIL_ROLE_INDEX);

const isMissingCollectionError = (error) =>
  error?.code === 26 || error?.codeName === "NamespaceNotFound";

async function getIndexes(collection) {
  try {
    return await collection.listIndexes().toArray();
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
}

async function getDuplicateEmailRoleGroups(collection) {
  try {
    return await collection.aggregate([
      { $match: { email: { $type: "string" } } },
      {
        $project: {
          email: { $toLower: { $trim: { input: "$email" } } },
          rol: {
            $toLower: {
              $trim: {
                input: {
                  $cond: [
                    { $eq: [{ $type: "$rol" }, "string"] },
                    "$rol",
                    "",
                  ],
                },
              },
            },
          },
        },
      },
      { $group: { _id: { email: "$email", rol: "$rol" }, total: { $sum: 1 } } },
      { $match: { total: { $gt: 1 } } },
      { $limit: 10 },
    ]).toArray();
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
}

export async function migratePublicAccountEmailIndexes({
  models = [Donante, Recolector],
  apply = false,
} = {}) {
  const plans = [];
  for (const Model of models) {
    const collection = Model.collection;
    const [indexes, duplicates] = await Promise.all([
      getIndexes(collection),
      getDuplicateEmailRoleGroups(collection),
    ]);
    if (duplicates.length > 0) {
      throw new Error(
        `La colección ${collection.collectionName} tiene correos duplicados para el mismo rol normalizado; corrige esos registros antes de migrar.`
      );
    }

    plans.push({
      collection,
      collectionName: collection.collectionName,
      legacyIndexes: indexes.filter(isLegacyUniqueEmailIndex),
      incompatibleTargetIndexes: indexes.filter((index) =>
        hasIndexKeys(index, EMAIL_ROLE_INDEX) &&
        !isCompatibleEmailRoleIndex(index)
      ),
      compatibleTargetExists: indexes.some(isCompatibleEmailRoleIndex),
    });
  }

  if (!apply) {
    return plans.map(({
      collectionName,
      legacyIndexes,
      incompatibleTargetIndexes,
      compatibleTargetExists,
    }) => ({
      collectionName,
      legacyIndexesToDrop: legacyIndexes.map(({ name }) => name),
      targetIndexExists: compatibleTargetExists,
      targetIndexesToReplace: incompatibleTargetIndexes.map(({ name }) => name),
    }));
  }

  for (const plan of plans) {
    await plan.collection.updateMany(
      { email: { $type: "string" } },
      EMAIL_NORMALIZATION_PIPELINE
    );
    for (const index of plan.incompatibleTargetIndexes) {
      await plan.collection.dropIndex(index.name);
    }
    if (!plan.compatibleTargetExists) {
      await plan.collection.createIndex(EMAIL_ROLE_INDEX, {
        unique: true,
        name: "email_1_rol_1",
      });
    }
  }

  for (const plan of plans) {
    for (const index of plan.legacyIndexes) {
      await plan.collection.dropIndex(index.name);
    }
  }

  return plans.map(({ collectionName }) => ({ collectionName, migrated: true }));
}
