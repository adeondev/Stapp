-- Cor sólida customizada para o banner do perfil.
-- Aditivo: coluna anulavel, sem tocar em dados existentes.
ALTER TABLE user_profiles ADD COLUMN banner_color TEXT;
