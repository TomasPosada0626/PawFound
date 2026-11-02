-- Ciudad de cada caso, normalizada (minúsculas y sin tildes), para las cifras de "Nuestro impacto".
-- La zona se guarda como "Barrio, Ciudad": la ciudad es lo que va después de la última coma.
ALTER TABLE pets ADD COLUMN city_key text;

UPDATE pets
SET city_key = lower(translate(trim(split_part(zone, ',', -1)), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))
WHERE zone LIKE '%,%' AND trim(split_part(zone, ',', -1)) <> '';

CREATE INDEX pets_city_key_idx ON pets (city_key);
