import { emitSimpleEvent } from "../core/events.ts";
import { accountIds, balanceOf, ensureAccount, postTransaction, settleDepositPayment, transferDeposit, transferOwnedAsset } from "../core/ledger.ts";
import type { DurableAsset, HousingCohort, PropertyInstance, SkillId, TravelOption, WorldState } from "../domain/model.ts";
import { addPlayerTimeline, playerHousehold, playerPerson } from "./system.ts";
import { isStateFundedFirstDegree } from "./student-journey.ts";

function command(world: WorldState, type: WorldState["player"]["commandLog"][number]["type"], payload: Record<string, string | number | boolean>): void {
  world.player.commandLog.push({ id: `command-${String(world.player.nextCommandId++).padStart(6, "0")}`, elapsedMonth: world.clock.elapsedMonths, type, payload });
}

function distanceKm(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }): number {
  const radius = 6_371;
  const latitude = (right.latitude - left.latitude) * Math.PI / 180;
  const longitude = (right.longitude - left.longitude) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(left.latitude * Math.PI / 180) * Math.cos(right.latitude * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function travelOptions(world: WorldState, destinationCityId: string): TravelOption[] {
  const origin = world.cities.find((city) => city.id === world.player.currentCityId);
  const destination = world.cities.find((city) => city.id === destinationCityId);
  if (!origin || !destination || origin.id === destination.id) return [];
  const distance = distanceKm(origin, destination);
  const options: TravelOption[] = [];
  if (distance <= 850) options.push({ originCityId: origin.id, destinationCityId: destination.id, mode: "road", distanceKm: distance, durationDays: Math.max(1, Math.ceil(distance / 650)), priceCents: Math.max(2_000_00, distance * 1_600), providerId: `transport-sector:${origin.id}` });
  if (distance <= 2_200) options.push({ originCityId: origin.id, destinationCityId: destination.id, mode: "rail", distanceKm: distance, durationDays: Math.max(1, Math.ceil(distance / 900)), priceCents: Math.max(3_500_00, distance * 2_400), providerId: `transport-sector:${origin.id}` });
  options.push({ originCityId: origin.id, destinationCityId: destination.id, mode: "air", distanceKm: distance, durationDays: Math.max(1, Math.ceil(distance / 6_000)), priceCents: Math.max(8_000_00, distance * 3_800), providerId: `transport-sector:${origin.id}` });
  return options.sort((left, right) => left.priceCents - right.priceCents);
}

export function startTravel(world: WorldState, destinationCityId: string, mode: TravelOption["mode"], relocation = false): boolean {
  if (world.player.activeTravel) return false;
  const option = travelOptions(world, destinationCityId).find((item) => item.mode === mode);
  if (!option) return false;
  const tx = transferDeposit(world, world.player.householdId, option.providerId, option.priceCents, "TRAVEL", `Поездка: ${option.originCityId} → ${option.destinationCityId}`);
  if (!tx) return false;
  world.player.activeTravel = { ...option, startedAtMonth: world.clock.elapsedMonths, remainingDays: option.durationDays, relocation };
  command(world, relocation ? "RELOCATE" : "START_TRAVEL", { destinationCityId, mode, relocation });
  emitSimpleEvent(world, "TravelStarted", "Поездка началась", `${option.originCityId} → ${option.destinationCityId}`, [world.player.personId, option.providerId], "info", [tx], { priceCents: option.priceCents, durationDays: option.durationDays });
  addPlayerTimeline(world, "travel", "Выезд", `${option.destinationCityId} · ${mode}`);
  return true;
}

export function applyUniversity(world: WorldState, programId: string): boolean {
  const program = world.universityPrograms.find((item) => item.id === programId);
  const university = program && world.universities.find((item) => item.id === program.universityId);
  if (!program || !university || world.player.activeUniversityEnrollment || world.player.universityApplications.some((application) => application.programId === programId)) return false;
  const person = playerPerson(world);
  const skills = Object.entries(program.requiredSkills) as Array<[SkillId, number]>;
  const educationRanks = { basic: 0, secondary: 1, bachelor: 2, master: 3, doctorate: 4 };
  const educationOk = educationRanks[person.educationLevel] >= educationRanks[program.minimumEducation];
  const skillScore = skills.length ? Math.round(skills.reduce((sum, [skill, required]) => sum + Math.min(12_000, person.skills[skill] * 10_000 / Math.max(1, required)), 0) / skills.length) : 10_000;
  const competition = Math.round(program.occupiedSeats * 2_000 / Math.max(1, program.capacity));
  const scoreBps = Math.round(skillScore * 0.72 + person.reputationBps * 0.28) - competition;
  const admitted = educationOk && program.occupiedSeats < program.capacity && scoreBps >= 5_500;
  const application = { id: `application-${String(world.nextApplicationId++).padStart(6, "0")}`, universityId: university.id, programId, submittedAtMonth: world.clock.elapsedMonths, scoreBps, status: admitted ? "admitted" as const : "rejected" as const, reason: !educationOk ? "Недостаточный уровень образования" : program.occupiedSeats >= program.capacity ? "Нет свободных мест" : admitted ? "Конкурс пройден" : "Не пройден конкурс" };
  world.player.universityApplications.push(application);
  command(world, "APPLY_UNIVERSITY", { programId });
  emitSimpleEvent(world, admitted ? "UniversityAdmitted" : "UniversityRejected", admitted ? "Поступление одобрено" : "Заявка отклонена", `${university.shortName} · ${program.name}: ${application.reason}`, [person.id, university.id], admitted ? "positive" : "attention", [], { scoreBps });
  return admitted;
}

export function enrollUniversity(world: WorldState, programId: string): boolean {
  const application = world.player.universityApplications.find((item) => item.programId === programId && item.status === "admitted");
  const program = world.universityPrograms.find((item) => item.id === programId);
  const university = program && world.universities.find((item) => item.id === program.universityId);
  if (!application || !program || !university || world.player.activeUniversityEnrollment) return false;
  if (program.attendanceMode === "ON_CAMPUS" && world.player.currentCityId !== university.cityId) return false;
  const tuition = program.tuitionPerYearCents;
  const stateFunded = isStateFundedFirstDegree(world, program);
  const payerId = stateFunded
    ? world.governments.find((government) => government.countryId === world.cities.find((city) => city.id === university.cityId)?.countryId)?.id
    : world.player.householdId;
  const tx = payerId && transferDeposit(world, payerId, university.id, tuition, "UNIVERSITY_TUITION", `${stateFunded ? "Бюджетное место" : "Обучение"}: ${university.shortName} · ${program.name}`);
  if (!tx) return false;
  application.status = "enrolled";
  program.occupiedSeats += 1;
  world.player.activeUniversityEnrollment = { universityId: university.id, programId, startedAtMonth: world.clock.elapsedMonths, completedMonths: 0, durationMonths: program.durationMonths, nextTuitionMonth: world.clock.elapsedMonths + 12, status: "active" };
  world.player.educationHistory.push({ universityId: university.id, programId, startedAtMonth: world.clock.elapsedMonths, completedAtMonth: null });
  command(world, "ENROLL_UNIVERSITY", { programId, tuitionCents: tuition });
  emitSimpleEvent(world, "UniversityEnrolled", "Зачисление", `${university.shortName} · ${program.name} · ${stateFunded ? "бюджетное место" : "платное обучение"}`, [world.player.personId, university.id], "positive", [tx], { tuitionCents: tuition, durationMonths: program.durationMonths, stateFunded });
  addPlayerTimeline(world, "education", "Поступление", `${university.shortName} · ${program.name}`);
  return true;
}

function availableHousing(world: WorldState, cohortId: string): HousingCohort | undefined {
  return world.housingCohorts.find((cohort) => cohort.id === cohortId && cohort.cityId === world.player.currentCityId && cohort.availableUnits > 0);
}

function materializeProperty(world: WorldState, cohort: HousingCohort): PropertyInstance {
  const id = `property-${String(world.nextPropertyId++).padStart(7, "0")}`;
  const property: PropertyInstance = { id, sourceCohortId: cohort.id, cityId: cohort.cityId, type: cohort.type, sizeSqm: cohort.averageSizeSqm, qualityBps: cohort.qualityBps, conditionBps: 9_000, purchasePriceCents: cohort.salePriceCents, currentValueCents: cohort.salePriceCents, ownerId: cohort.ownerSectorId, tenantId: null, monthlyRentCents: cohort.monthlyRentCents, maintenanceCents: Math.round(cohort.monthlyRentCents * 0.12), ownershipHistory: [{ ownerId: cohort.ownerSectorId, acquiredAtMonth: 0, priceCents: cohort.constructionCostCents }] };
  cohort.availableUnits -= 1;
  world.properties.push(property);
  return property;
}

export function rentProperty(world: WorldState, cohortId: string): boolean {
  if (world.player.residencePropertyId) return false;
  const cohort = availableHousing(world, cohortId);
  if (!cohort) return false;
  const tx = transferDeposit(world, world.player.householdId, cohort.ownerSectorId, cohort.monthlyRentCents, "RENT", `Аренда жилья: ${cohort.cityId}`);
  if (!tx) return false;
  const property = materializeProperty(world, cohort);
  property.tenantId = world.player.householdId;
  world.player.residencePropertyId = property.id;
  command(world, "RENT_PROPERTY", { cohortId, propertyId: property.id });
  emitSimpleEvent(world, "PropertyRented", "Жильё арендовано", `${world.cities.find((city) => city.id === cohort.cityId)?.name} · ${property.sizeSqm} м²`, [world.player.householdId, cohort.ownerSectorId], "positive", [tx], { monthlyRentCents: cohort.monthlyRentCents });
  addPlayerTimeline(world, "housing", "Аренда жилья", `${property.sizeSqm} м²`);
  return true;
}

export function buyProperty(world: WorldState, cohortId: string): boolean {
  const cohort = availableHousing(world, cohortId);
  if (!cohort) return false;
  const id = `property-${String(world.nextPropertyId).padStart(7, "0")}`;
  const assetAccount = accountIds.property(world.player.householdId, id);
  ensureAccount(world.ledger, assetAccount, world.player.householdId, "Недвижимость", "asset");
  const tx = settleDepositPayment(world, world.player.householdId, cohort.ownerSectorId, cohort.salePriceCents, "PROPERTY_PURCHASE", `Покупка недвижимости: ${cohort.cityId}`, assetAccount, accountIds.operatingIncome(cohort.ownerSectorId));
  if (!tx) return false;
  const property = materializeProperty(world, cohort);
  property.ownerId = world.player.householdId;
  property.ownershipHistory.push({ ownerId: world.player.householdId, acquiredAtMonth: world.clock.elapsedMonths, priceCents: cohort.salePriceCents });
  world.player.propertyIds.push(property.id);
  world.player.residencePropertyId = property.id;
  command(world, "BUY_PROPERTY", { cohortId, propertyId: property.id });
  emitSimpleEvent(world, "PropertyPurchased", "Недвижимость куплена", `${world.cities.find((city) => city.id === cohort.cityId)?.name} · ${property.sizeSqm} м²`, [world.player.householdId, cohort.ownerSectorId], "positive", [tx], { priceCents: cohort.salePriceCents });
  addPlayerTimeline(world, "housing", "Покупка жилья", `${property.sizeSqm} м²`);
  return true;
}

export function buyDurable(world: WorldState, productId: string): boolean {
  const product = world.products.find((item) => item.id === productId);
  if (!product) return false;
  const id = `durable-${String(world.nextDurableAssetId++).padStart(7, "0")}`;
  const assetAccount = accountIds.durable(world.player.householdId, id);
  ensureAccount(world.ledger, assetAccount, world.player.householdId, product.name, "asset");
  const tx = settleDepositPayment(world, world.player.householdId, product.sellerId, product.priceCents, "DURABLE_PURCHASE", `Покупка: ${product.name}`, assetAccount, accountIds.operatingIncome(product.sellerId));
  if (!tx) { world.nextDurableAssetId -= 1; return false; }
  const asset: DurableAsset = { id, productId, ownerId: world.player.householdId, sellerId: product.sellerId, purchasedAtMonth: world.clock.elapsedMonths, purchasePriceCents: product.priceCents, ageMonths: 0, conditionBps: 10_000, maintenanceCents: product.operatingCostCents, resaleValueCents: Math.round(product.priceCents * 0.76), ownershipHistory: [{ ownerId: world.player.householdId, acquiredAtMonth: world.clock.elapsedMonths, priceCents: product.priceCents }] };
  world.durableAssets.push(asset);
  world.player.durableAssetIds.push(id);
  command(world, "BUY_DURABLE", { productId, assetId: id });
  emitSimpleEvent(world, "DurablePurchased", "Товар длительного пользования куплен", product.name, [world.player.householdId, product.sellerId], "positive", [tx], { priceCents: product.priceCents });
  addPlayerTimeline(world, "asset", "Покупка", product.name);
  return true;
}

export function sellDurable(world: WorldState, assetId: string, buyerId: string): boolean {
  const asset = world.durableAssets.find((item) => item.id === assetId && item.ownerId === world.player.householdId);
  const product = asset && world.products.find((item) => item.id === asset.productId);
  if (!asset || !product) return false;
  const oldAccount = accountIds.durable(world.player.householdId, asset.id);
  const bookValue = balanceOf(world, oldAccount);
  const salePrice = Math.min(bookValue, asset.resaleValueCents);
  if (bookValue > salePrice) {
    ensureAccount(world.ledger, accountIds.operatingExpense(world.player.householdId), world.player.householdId, "Расходы", "expense");
    postTransaction(world, "DEPRECIATION", `Износ: ${product.name}`, [
      { accountId: accountIds.operatingExpense(world.player.householdId), side: "debit", amountCents: bookValue - salePrice },
      { accountId: oldAccount, side: "credit", amountCents: bookValue - salePrice },
    ]);
  }
  const buyerAccount = accountIds.durable(buyerId, asset.id);
  const tx = transferOwnedAsset(world, buyerId, world.player.householdId, salePrice, buyerAccount, oldAccount, product.name);
  if (!tx) return false;
  asset.ownerId = buyerId;
  asset.ownershipHistory.push({ ownerId: buyerId, acquiredAtMonth: world.clock.elapsedMonths, priceCents: salePrice });
  world.player.durableAssetIds = world.player.durableAssetIds.filter((id) => id !== assetId);
  command(world, "SELL_DURABLE", { assetId, buyerId, salePriceCents: salePrice });
  emitSimpleEvent(world, "DurableResold", "Подержанный товар продан", product.name, [world.player.householdId, buyerId], "info", [tx], { salePriceCents: salePrice });
  return true;
}

export function progressPlayerWorld(world: WorldState): void {
  const travel = world.player.activeTravel;
  if (travel) {
    travel.remainingDays -= 30;
    if (travel.remainingDays <= 0) {
      const previousCityId = world.player.currentCityId;
      world.player.currentCityId = travel.destinationCityId;
      playerPerson(world).cityId = travel.destinationCityId;
      playerHousehold(world).cityId = travel.destinationCityId;
      if (!world.player.visitedCityIds.includes(travel.destinationCityId)) world.player.visitedCityIds.push(travel.destinationCityId);
      const countryId = world.cities.find((city) => city.id === travel.destinationCityId)?.countryId;
      if (countryId && !world.player.visitedCountryIds.includes(countryId)) world.player.visitedCountryIds.push(countryId);
      if (travel.relocation) {
        const residence = world.player.residenceHistory.at(-1);
        if (residence) residence.toMonth = world.clock.elapsedMonths;
        world.player.residenceHistory.push({ cityId: travel.destinationCityId, fromMonth: world.clock.elapsedMonths, toMonth: null });
        const household = playerHousehold(world);
        const employer = household.employerId && world.companies.find((company) => company.id === household.employerId);
        if (employer && employer.cityId !== travel.destinationCityId) {
          employer.employees = employer.employees.filter((id) => id !== household.id);
          household.employerId = null;
          playerPerson(world).occupationId = null;
        }
        world.player.residencePropertyId = null;
        emitSimpleEvent(world, "PlayerRelocated", "Переезд завершён", `${previousCityId} → ${travel.destinationCityId}`, [world.player.personId], "positive");
      }
      emitSimpleEvent(world, "TravelCompleted", "Поездка завершена", world.cities.find((city) => city.id === travel.destinationCityId)?.name ?? travel.destinationCityId, [world.player.personId], "positive");
      addPlayerTimeline(world, "travel", travel.relocation ? "Переезд" : "Прибытие", travel.destinationCityId);
      world.player.activeTravel = null;
    }
  }

  const enrollment = world.player.activeUniversityEnrollment;
  if (enrollment?.status === "active") {
    const program = world.universityPrograms.find((item) => item.id === enrollment.programId);
    const university = program && world.universities.find((item) => item.id === enrollment.universityId);
    if (program && university) {
      if (program.attendanceMode === "ON_CAMPUS" && world.player.currentCityId !== university.cityId) enrollment.status = "paused";
      if (world.clock.elapsedMonths >= enrollment.nextTuitionMonth) {
        const stateFunded = isStateFundedFirstDegree(world, program);
        const payerId = stateFunded
          ? world.governments.find((government) => government.countryId === world.cities.find((city) => city.id === university.cityId)?.countryId)?.id
          : world.player.householdId;
        const tx = payerId && transferDeposit(world, payerId, university.id, program.tuitionPerYearCents, "UNIVERSITY_TUITION", `${stateFunded ? "Бюджетное место" : "Следующий год обучения"}: ${university.shortName}`);
        if (tx) enrollment.nextTuitionMonth += 12;
        else enrollment.status = "paused";
      }
      if (enrollment.status === "active") {
        enrollment.completedMonths += 1;
        const person = playerPerson(world);
        for (const [skill, outcome] of Object.entries(program.skillOutcomes) as Array<[SkillId, number]>) {
          const qualityAdjustedOutcome = Math.min(10_000, Math.round(outcome * university.teachingQualityBps / 9_000));
          const monthlyGain = Math.max(1, Math.round(qualityAdjustedOutcome * 0.45 / Math.max(1, program.durationMonths)));
          person.skills[skill] = Math.min(qualityAdjustedOutcome, person.skills[skill] + monthlyGain);
        }
        if (enrollment.completedMonths < enrollment.durationMonths && enrollment.completedMonths % 12 === 0) {
          const year = enrollment.completedMonths / 12;
          emitSimpleEvent(world, "UniversityYearCompleted", `Завершён ${year}-й курс`, `${university.shortName} · ${program.name}`, [world.player.personId, university.id], "positive");
          addPlayerTimeline(world, "education", `Завершён ${year}-й курс`, `${university.shortName} · ${program.name}`);
        }
      }
      if (enrollment.completedMonths >= enrollment.durationMonths) {
        enrollment.status = "completed";
        world.player.completedProgramIds.push(program.id);
        const history = world.player.educationHistory.find((item) => item.programId === program.id && item.completedAtMonth === null);
        if (history) history.completedAtMonth = world.clock.elapsedMonths;
        const person = playerPerson(world);
        person.educationLevel = program.degree;
        for (const [skill, outcome] of Object.entries(program.skillOutcomes) as Array<[SkillId, number]>) {
          const qualityAdjustedOutcome = Math.min(10_000, Math.round(outcome * university.teachingQualityBps / 9_000));
          person.skills[skill] = Math.max(person.skills[skill], qualityAdjustedOutcome);
        }
        program.occupiedSeats = Math.max(0, program.occupiedSeats - 1);
        world.player.activeUniversityEnrollment = null;
        emitSimpleEvent(world, "UniversityGraduated", "Получен диплом", `${university.shortName} · ${program.name}`, [person.id, university.id], "positive");
        addPlayerTimeline(world, "education", "Диплом", `${university.shortName} · ${program.name}`);
      }
    }
  }
  if (enrollment?.status === "paused") {
    const program = world.universityPrograms.find((item) => item.id === enrollment.programId);
    const university = program && world.universities.find((item) => item.id === enrollment.universityId);
    if (program && university && (program.attendanceMode !== "ON_CAMPUS" || world.player.currentCityId === university.cityId)) enrollment.status = "active";
  }

  const residence = world.player.residencePropertyId && world.properties.find((property) => property.id === world.player.residencePropertyId);
  if (residence) {
    const payment = residence.ownerId === world.player.householdId ? residence.maintenanceCents : residence.monthlyRentCents;
    const recipient = residence.ownerId === world.player.householdId ? `housing-sector:${residence.cityId}` : residence.ownerId;
    transferDeposit(world, world.player.householdId, recipient, payment, "RENT", residence.ownerId === world.player.householdId ? "Содержание жилья" : "Ежемесячная аренда");
  }
  for (const assetId of world.player.durableAssetIds) {
    const asset = world.durableAssets.find((item) => item.id === assetId);
    const product = asset && world.products.find((item) => item.id === asset.productId);
    if (!asset || !product) continue;
    asset.ageMonths += 1;
    asset.conditionBps = Math.max(1_000, 10_000 - Math.round(asset.ageMonths * 9_000 / product.durabilityMonths));
    asset.resaleValueCents = Math.max(Math.round(asset.purchasePriceCents * 0.08), Math.round(asset.purchasePriceCents * asset.conditionBps / 12_500));
  }
}
