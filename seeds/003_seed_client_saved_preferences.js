exports.seed = async function seed(knex) {
  await knex.transaction(async (trx) => {
    const client = await trx("users")
      .select("id")
      .where({ email: "client@example.com" })
      .first();
    const driver = await trx("users")
      .select("id")
      .where({ email: "driver@example.com" })
      .first();

    if (!client) {
      throw new Error("Seed user client@example.com was not found.");
    }

    if (!driver) {
      throw new Error("Seed user driver@example.com was not found.");
    }

    const serviceTypes = [
      {
        code: "standard",
        name: "Standard",
        description: "Default everyday ride option.",
        icon: "car",
        base_price: 0,
        is_active: true,
        sort_order: 10,
      },
      {
        code: "premium",
        name: "Premium",
        description: "Higher comfort ride option.",
        icon: "gem",
        base_price: 7500,
        is_active: true,
        sort_order: 20,
      },
      {
        code: "pool",
        name: "Pool",
        description: "Shared ride option.",
        icon: "users",
        base_price: 0,
        is_active: true,
        sort_order: 30,
      },
    ];

    for (const serviceType of serviceTypes) {
      await trx("service_types")
        .insert({
          ...serviceType,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .onConflict("code")
        .merge({
          name: serviceType.name,
          description: serviceType.description,
          icon: serviceType.icon,
          base_price: serviceType.base_price,
          is_active: serviceType.is_active,
          sort_order: serviceType.sort_order,
          updated_at: trx.fn.now(),
        });
    }

    const savedDestinations = [
      {
        label: "Home",
        place_name: "Client Home",
        formatted_address: "New York, NY, USA",
        place_id: "seed-client-home",
        lng: -74.006,
        lat: 40.7128,
        usage_count: 5,
      },
      {
        label: "Work",
        place_name: "Downtown Office",
        formatted_address: "350 5th Ave, New York, NY 10118, USA",
        place_id: "seed-client-work",
        lng: -73.9857,
        lat: 40.7484,
        usage_count: 3,
      },
      {
        label: "Airport",
        place_name: "John F. Kennedy International Airport",
        formatted_address: "Queens, NY 11430, USA",
        place_id: "seed-client-jfk",
        lng: -73.7781,
        lat: 40.6413,
        usage_count: 2,
      },
    ];

    for (const destination of savedDestinations) {
      const existingDestination = await trx("user_saved_destinations")
        .select("id")
        .where({
          user_id: client.id,
          place_id: destination.place_id,
        })
        .whereNull("deleted_at")
        .first();

      const destinationValues = {
        label: destination.label,
        place_name: destination.place_name,
        formatted_address: destination.formatted_address,
        place_id: destination.place_id,
        location: trx.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [
          destination.lng,
          destination.lat,
        ]),
        usage_count: destination.usage_count,
        last_used_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      };

      if (existingDestination) {
        await trx("user_saved_destinations")
          .where({ id: existingDestination.id })
          .update(destinationValues);
      } else {
        await trx("user_saved_destinations").insert({
          user_id: client.id,
          ...destinationValues,
          created_at: trx.fn.now(),
        });
      }
    }

    const completedRide = await trx("rides")
      .select("id", "completed_at")
      .where({
        client_id: client.id,
        driver_id: driver.id,
        status: "completed",
      })
      .first();

    let completedAt = completedRide?.completed_at;

    if (!completedRide) {
      const [ride] = await trx("rides")
        .insert({
          client_id: client.id,
          driver_id: driver.id,
          status: "completed",
          service_type: "standard",
          pickup_address: "New York, NY, USA",
          dropoff_address: "350 5th Ave, New York, NY 10118, USA",
          has_destination: true,
          pickup_point: trx.raw("ST_GeogFromText(?)", ["POINT(-74.0060 40.7128)"]),
          dropoff_point: trx.raw("ST_GeogFromText(?)", ["POINT(-73.9857 40.7484)"]),
          estimated_distance_meters: 6200,
          estimated_duration_seconds: 1500,
          actual_distance_meters: 6400,
          actual_duration_seconds: 1560,
          estimated_fare_amount: 22.5,
          final_fare_amount: 24,
          surge_multiplier: 1,
          currency: "USD",
          pricing_breakdown: JSON.stringify({ seed: true }),
          requested_at: trx.fn.now(),
          accepted_at: trx.fn.now(),
          driver_arrived_at: trx.fn.now(),
          started_at: trx.fn.now(),
          completed_at: trx.fn.now(),
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning(["id", "completed_at"]);

      completedAt = ride.completed_at;
    }

    const existingPreferredDriver = await trx("user_preferred_drivers")
      .select("id")
      .where({
        user_id: client.id,
        driver_id: driver.id,
      })
      .whereNull("deleted_at")
      .first();

    const preferredDriverValues = {
      usage_count: 1,
      last_ride_at: completedAt || trx.fn.now(),
      updated_at: trx.fn.now(),
    };

    if (existingPreferredDriver) {
      await trx("user_preferred_drivers")
        .where({ id: existingPreferredDriver.id })
        .update(preferredDriverValues);
    } else {
      await trx("user_preferred_drivers").insert({
        user_id: client.id,
        driver_id: driver.id,
        ...preferredDriverValues,
        created_at: trx.fn.now(),
      });
    }
  });
};
