-- Banner do perfil. Aditivo: coluna anulavel, sem backfill e sem tocar em nada
-- que ja existia. Cliente antigo continua funcionando contra este banco, e
-- servidor novo continua servindo cliente antigo.
--
-- O arquivo em si mora em disco (`data/banners/<user_id>.webp`), igual ao
-- avatar; aqui fica so a marca de que existe, e e ela que vira `has_banner` no
-- protocolo. Guardar a extensao — e nao um booleano — deixa espaco para um dia
-- existir mais de um formato, exatamente como `avatar_ext`.
ALTER TABLE user_profiles ADD COLUMN banner_ext TEXT;
