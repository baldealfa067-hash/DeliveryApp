-- Verificação real de prestador
-- Adiciona campos de verificação de identidade à tabela profiles

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'none'
    CHECK (verification_status IN ('none', 'pendente', 'aprovado', 'rejeitado')),
  ADD COLUMN IF NOT EXISTS verification_doc_url text,
  ADD COLUMN IF NOT EXISTS verification_selfie_url text,
  ADD COLUMN IF NOT EXISTS verification_reason text,
  ADD COLUMN IF NOT EXISTS verification_submitted_at timestamptz;

-- Bucket privado para documentos de identidade
INSERT INTO storage.buckets (id, name, public)
VALUES ('verification', 'verification', false)
ON CONFLICT (id) DO NOTHING;

-- O prestador pode enviar/remover os próprios ficheiros de verificação
CREATE POLICY "Users upload own verification files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'verification' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users read own verification files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'verification' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own verification files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'verification' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Admin pode ver os documentos para aprovar/rejeitar
CREATE POLICY "Admins read all verification files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'verification' AND public.has_role(auth.uid(), 'admin'));

-- Impede o prestador de se auto-verificar:
-- nunca pode marcar is_verified=true nem definir verification_status como
-- 'aprovado'/'rejeitado' (isso é exclusivo do admin). Pode editar o resto
-- do perfil normalmente, submeter (pendente) e repor (none).
DROP POLICY IF EXISTS "Providers can update own profile" ON public.profiles;
CREATE POLICY "Providers can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(is_verified, false) = false
    AND NEW.verification_status NOT IN ('aprovado', 'rejeitado')
  );

-- Nota: o admin continua a conseguir alterar is_verified e verification_status
-- via a policy existente "Admins manage profiles".