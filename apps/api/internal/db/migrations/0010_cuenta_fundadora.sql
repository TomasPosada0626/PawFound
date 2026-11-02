-- La cuenta de quien creó PawFound: se identifica en su perfil como tal.
ALTER TABLE users ADD COLUMN founder boolean NOT NULL DEFAULT false;
